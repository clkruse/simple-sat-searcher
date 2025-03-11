"""
Earth Engine data extraction service.
This module handles interactions with the Google Earth Engine API 
for extracting satellite imagery data.
"""

import os
import logging
import datetime
import json
import hashlib
import multiprocessing

import ee
import geopandas as gpd
import numpy as np
import xarray as xr
from shapely.geometry import Point

from config import PROJECTS_DIR, PIXEL_SIZE, BAND_IDS, EE_PROJECT

# Initialize logger
logger = logging.getLogger(__name__)

# Add this new standalone function for multiprocessing
def process_point_for_multiprocessing(point_data, extractor=None, start_date=None, end_date=None):
    """
    Standalone function to process a single point in a separate process.
    This function initializes Earth Engine for each worker process.
    
    Args:
        point_data (tuple): Tuple containing (index, row) from GeoDataFrame
        extractor (GEEDataExtractor): The extractor instance (not used directly, just for parameters)
        start_date (str): Start date string
        end_date (str): End date string
        
    Returns:
        tuple: (index, chip, label, success)
    """
    idx, row = point_data
    
    try:
        # Initialize Earth Engine for this worker process
        import ee
        try:
            # Get parameters from row if available, otherwise use defaults
            point_start_date = row.get('start_date', start_date) if hasattr(row, 'get') else start_date
            point_end_date = row.get('end_date', end_date) if hasattr(row, 'get') else end_date
            point_clear_threshold = float(row.get('clear_threshold', 0.75)) if hasattr(row, 'get') else 0.75
            point_class = row['class'] if 'class' in row else 'unknown'
            
            # Re-initialize EE in this process
            ee.Initialize(opt_url="https://earthengine-highvolume.googleapis.com")
            
            # Extract point coordinates
            lng, lat = row.geometry.x, row.geometry.y
            point = ee.Geometry.Point([lng, lat])
            
            # Create composite image using the point-specific dates
            if extractor.collection == 'S2':
                s2 = ee.ImageCollection("COPERNICUS/S2_HARMONIZED")
                
                # Cloud Score+
                csPlus = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
                QA_BAND = "cs_cdf"
                
                composite = (
                    s2.filterDate(point_start_date, point_end_date)
                    .linkCollection(csPlus, [QA_BAND])
                    .map(lambda img: img.updateMask(img.select(QA_BAND).gte(point_clear_threshold)))
                    .median()
                )
            elif extractor.collection == 'S1':
                s1 = ee.ImageCollection("COPERNICUS/S1_GRD")
                composite = (
                    s1.filterDate(point_start_date, point_end_date)
                    .filter(ee.Filter.eq('instrumentMode', 'IW'))
                    .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
                    .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                    .mosaic()
                )
            else:
                raise ValueError(f'Collection {extractor.collection} not recognized')
            
            # Calculate buffer distance in meters (simple approximation)
            buffer_meters = 10 * extractor.chip_size  # 10m resolution for S2
            if extractor.collection == 'S1':
                buffer_meters = 20 * extractor.chip_size  # 20m resolution for S1
            
            # Buffer the point
            buffered_point = point.buffer(buffer_meters)
            
            # Extract the chip
            chip = composite.clipToBoundsAndScale(
                geometry=buffered_point, 
                width=extractor.chip_size, 
                height=extractor.chip_size
            )
            
            try:
                # Get the pixels
                pixels = ee.data.computePixels({
                    "bandIds": extractor.band_ids,
                    "expression": chip,
                    "fileFormat": "NUMPY_NDARRAY",
                })
                
                # Convert from a structured array to a numpy array
                pixels = np.array(pixels.tolist())
                
                return (idx, pixels, point_class, True)
                
            except Exception as e:
                logger.error(f"Error extracting chip at ({lng}, {lat}): {e}")
                return (idx, None, None, False)
                
        except Exception as e:
            logger.error(f"Error initializing Earth Engine in worker: {e}")
            return (idx, None, None, False)
            
    except Exception as e:
        logger.error(f"Error processing point {idx}: {e}")
        return (idx, None, None, False)

class GEEDataExtractor:
    """
    Extract satellite imagery from Google Earth Engine for labeled points
    """
    
    def __init__(self, project_id, collection='S2', chip_size=64, 
                 ee_project="earth-engine-ck"):
        """
        Initialize the GEE data extractor
        
        Args:
            project_id (str): Project ID to extract data for
            collection (str): Satellite collection ('S1' or 'S2')
            chip_size (int): Size of chips to extract in pixels
            ee_project (str): Google Earth Engine project ID
        """
        self.project_id = project_id
        self.collection = collection
        self.chip_size = chip_size
        self.ee_project = ee_project
        self.band_ids = BAND_IDS.get(collection)
        self.resolution = PIXEL_SIZE.get(collection)
        
        # Initialize Earth Engine
        try:
            ee.Initialize(
                opt_url="https://earthengine-highvolume.googleapis.com",
                project=ee_project,
            )
            logger.info("Earth Engine initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Earth Engine: {e}")
            raise e
    
    def create_image_collection(self, start_date, end_date, clear_threshold=0.75):
        """
        Create an image collection filtered by date and cloud cover
        
        Args:
            start_date (str): Start date in format 'YYYY-MM-DD'
            end_date (str): End date in format 'YYYY-MM-DD'
            clear_threshold (float): Threshold for cloud cover (0-1)
            
        Returns:
            ee.Image: Composite image
        """
        if self.collection == 'S2':
            s2 = ee.ImageCollection("COPERNICUS/S2_HARMONIZED")

            # Cloud Score+ from L1C data; can be applied to L1C or L2A.
            csPlus = ee.ImageCollection(
                "GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
            QA_BAND = "cs_cdf"

            self.composite = (
                s2.filterDate(start_date, end_date)
                .linkCollection(csPlus, [QA_BAND])
                .map(lambda img:
                     img.updateMask(img.select(QA_BAND).gte(clear_threshold)))
                .median())

        elif self.collection == 'S1':
            s1 = ee.ImageCollection("COPERNICUS/S1_GRD")
            self.composite = (
                s1.filterDate(start_date, end_date)
                .filter(ee.Filter.eq('instrumentMode', 'IW'))
                .filter(ee.Filter.listContains(
                        "transmitterReceiverPolarisation", "VV"))
                .filter(ee.Filter.listContains(
                        "transmitterReceiverPolarisation", "VH"))
                .mosaic())
        else:
            raise ValueError(f'Collection {self.collection} not recognized.')
            
        return self.composite
    
    def extract_chip(self, point_gdf, buffer_factor=1):
        """
        Extract a chip from the composite image centered on a point
        
        Args:
            point_gdf (GeoDataFrame): GeoDataFrame with a single point
            buffer_factor (int): Factor to multiply the chip size by for buffer
            
        Returns:
            np.ndarray: Extracted chip
        """
        # Get the point coordinates
        lon, lat = point_gdf.geometry.x.iloc[0], point_gdf.geometry.y.iloc[0]
        point = ee.Geometry.Point([lon, lat])
        
        # Calculate buffer distance in meters
        buffer_meters = self.resolution * self.chip_size * buffer_factor / 2
        
        # Buffer the point
        buffered_point = point.buffer(buffer_meters)
        
        # Extract the chip
        chip = self.composite.clipToBoundsAndScale(
            geometry=buffered_point, 
            width=self.chip_size, 
            height=self.chip_size
        )
        
        try:
            pixels = ee.data.computePixels({
                "bandIds": self.band_ids,
                "expression": chip,
                "fileFormat": "NUMPY_NDARRAY",
            })
            
            # Convert from a structured array to a numpy array
            pixels = np.array(pixels.tolist())
            
            return pixels
            
        except Exception as e:
            logger.error(f"Error extracting chip at {lon}, {lat}: {e}")
            return None
    
    def _get_cache_key(self, point_gdf, start_date, end_date, label):
        """
        Generate a unique cache key for a point based on its properties.
        
        Args:
            point_gdf (GeoDataFrame): GeoDataFrame with a single point
            start_date (str): Start date in format 'YYYY-MM-DD'
            end_date (str): End date in format 'YYYY-MM-DD'
            label (str): Label class for the point
            
        Returns:
            str: Unique cache key
        """
        # Get point coordinates with fixed precision to ensure consistent hashing
        lon = f"{point_gdf.geometry.x.iloc[0]:.6f}"
        lat = f"{point_gdf.geometry.y.iloc[0]:.6f}"
        
        # Create a string with all relevant parameters
        params = f"{lon}_{lat}_{start_date}_{end_date}_{self.collection}_{self.chip_size}_{label}"
        
        # Generate hash
        return hashlib.md5(params.encode()).hexdigest()

    def _check_cache(self, cache_key, output_dir):
        """
        Check if data for a point exists in cache.
        
        Args:
            cache_key (str): Cache key for the point
            output_dir (str): Directory where cached data is stored
            
        Returns:
            tuple: (bool, str) - (whether data exists in cache, path to cached data if exists)
        """
        # Only use the new descriptive format
        cache_file = os.path.join(output_dir, f"chip_{self.collection}_{self.chip_size}px_{cache_key}.npz")
        return os.path.exists(cache_file), cache_file

    def _save_to_cache(self, cache_key, chip_data, output_dir):
        """
        Save extracted chip data to cache.
        
        Args:
            cache_key (str): Cache key for the point
            chip_data (np.ndarray): Extracted chip data
            output_dir (str): Directory to save cached data
        """
        # Create more descriptive filename including chip size (resolution)
        cache_file = os.path.join(output_dir, f"chip_{self.collection}_{self.chip_size}px_{cache_key}.npz")
        np.savez_compressed(cache_file, chip_data=chip_data)

    def _load_from_cache(self, cache_file):
        """
        Load chip data from cache.
        
        Args:
            cache_file (str): Path to cached data file
            
        Returns:
            np.ndarray: Cached chip data
        """
        with np.load(cache_file) as data:
            return data['chip_data']

    def _find_matching_cache(self, points_gdf, start_date, end_date, output_dir):
        """
        Find existing cached data that matches the current extraction parameters.
        
        Args:
            points_gdf (GeoDataFrame): GeoDataFrame with points
            start_date (str): Start date in format 'YYYY-MM-DD'
            end_date (str): End date in format 'YYYY-MM-DD'
            output_dir (str): Directory where cached data is stored
            
        Returns:
            tuple: (cached_points, cached_dataset, cached_metadata) or (None, None, None) if no match
        """
        if not os.path.exists(output_dir):
            return None, None, None
            
        # Get all netCDF files in the output directory
        nc_files = [f for f in os.listdir(output_dir) if f.endswith('.nc')]
        
        for nc_file in sorted(nc_files, reverse=True):  # Check most recent first
            try:
                # Load the dataset
                ds = xr.open_dataset(os.path.join(output_dir, nc_file))
                
                # Check if parameters match
                if (ds.attrs['collection'] == self.collection and
                    ds.attrs['start_date'] == start_date and
                    ds.attrs['end_date'] == end_date and
                    ds.attrs['chip_size'] == self.chip_size):
                    
                    # Get metadata file
                    metadata_file = nc_file.replace('.nc', '_metadata.json')
                    metadata_path = os.path.join(output_dir, metadata_file)
                    
                    if os.path.exists(metadata_path):
                        with open(metadata_path, 'r') as f:
                            metadata = json.load(f)
                    else:
                        metadata = None
                    
                    # Create GeoDataFrame from cached points
                    cached_points = gpd.GeoDataFrame(
                        geometry=[Point(lon, lat) for lon, lat in 
                                zip(ds.longitude.values, ds.latitude.values)],
                        data={'class': ds.label.values},
                        crs="EPSG:4326"
                    )
                    
                    return cached_points, ds, metadata
                    
                ds.close()
                
            except Exception as e:
                logger.warning(f"Error reading cache file {nc_file}: {e}")
                continue
                
        return None, None, None

    def _get_uncached_points(self, points_gdf, cached_points):
        """
        Get points that are not in the cache.
        
        Args:
            points_gdf (GeoDataFrame): All points
            cached_points (GeoDataFrame): Previously cached points
            
        Returns:
            GeoDataFrame: Points that need to be extracted
        """
        if cached_points is None or len(cached_points) == 0:
            return points_gdf
            
        # Function to check if a point exists in cached points
        def point_exists(point):
            for cached_point in cached_points.geometry:
                if point.distance(cached_point) < 1e-6:  # Small threshold for floating point comparison
                    return True
            return False
            
        # Filter out points that exist in cache
        uncached_mask = [not point_exists(point) for point in points_gdf.geometry]
        return points_gdf[uncached_mask]

    def _process_single_point(self, point_data, start_date, end_date):
        """
        Process a single point for chip extraction
        
        Args:
            point_data (tuple): Tuple containing (index, row) from GeoDataFrame
            start_date (str): Start date in format 'YYYY-MM-DD'
            end_date (str): End date in format 'YYYY-MM-DD'
            
        Returns:
            tuple: (index, chip, label, success)
        """
        idx, row = point_data
        point_gdf = gpd.GeoDataFrame(geometry=[row.geometry], crs=row.geometry.crs)
        try:
            chip = self.extract_chip(point_gdf)
            if chip is not None:
                return (idx, chip, row['class'], True)
            else:
                logger.warning(f"Failed to extract chip for point {idx+1}")
                return (idx, None, None, False)
        except Exception as e:
            logger.error(f"Error extracting chip for point {idx+1}: {e}")
            return (idx, None, None, False)

    def extract_chips_for_project(self, start_date, end_date, clear_threshold=0.75, progress_callback=None, num_workers=None, custom_points_geojson=None):
        """
        Extract chips for all points in a project
        
        Args:
            start_date (str): Start date in format 'YYYY-MM-DD'
            end_date (str): End date in format 'YYYY-MM-DD'
            clear_threshold (float): Threshold for cloud cover (0-1)
            progress_callback (callable): Optional callback function for progress updates
            num_workers (int): Number of worker processes to use. If None, uses CPU count - 1
            custom_points_geojson (dict): Optional GeoJSON to use instead of loading from file
            
        Returns:
            tuple: (output_file, metadata_file) paths
        """
        # Get the project directory
        project_dir = os.path.join(PROJECTS_DIR, self.project_id)
        if not os.path.exists(project_dir):
            raise FileNotFoundError(f"Project directory {project_dir} not found")
        
        # Create output directory for extracted data
        output_dir = os.path.join(project_dir, "extracted_data")
        os.makedirs(output_dir, exist_ok=True)
        
        # Define standard filenames for consistent data storage (no timestamps)
        standard_data_file = os.path.join(output_dir, f"{self.collection}_{self.chip_size}px_extracted_data.nc")
        standard_metadata_file = os.path.join(output_dir, f"{self.collection}_{self.chip_size}px_metadata.json")
        
        # Load points either from custom GeoJSON or from file
        if custom_points_geojson:
            # Load points from the provided GeoJSON
            features = custom_points_geojson['features']
            
            # Extract properties including time parameters
            geometries = []
            properties = []
            
            for feature in features:
                if 'geometry' in feature and 'coordinates' in feature['geometry']:
                    coords = feature['geometry']['coordinates']
                    geometries.append(Point(coords[0], coords[1]))
                    
                    # Get all properties
                    prop_dict = feature.get('properties', {}).copy()
                    
                    # Ensure time parameters are included
                    if 'start_date' not in prop_dict:
                        prop_dict['start_date'] = start_date
                    if 'end_date' not in prop_dict:
                        prop_dict['end_date'] = end_date
                    if 'clear_threshold' not in prop_dict:
                        prop_dict['clear_threshold'] = clear_threshold
                        
                    properties.append(prop_dict)
            
            # Create GeoDataFrame with properties
            points_gdf = gpd.GeoDataFrame(geometry=geometries, data=properties)
            points_gdf.set_crs("EPSG:4326", inplace=True)
            logger.info(f"Using custom points GeoJSON with {len(points_gdf)} points")
        else:
            # Load points from file - should use points.geojson now
            points_gdf = self._load_points(project_dir)
            logger.info(f"Loaded {len(points_gdf)} points from project files")
        
        # Ensure the GeoDataFrame has a CRS
        if points_gdf.crs is None:
            points_gdf.set_crs("EPSG:4326", inplace=True)
            logger.warning("Points GeoDataFrame had no CRS, setting to EPSG:4326")
        
        # Check for existing data in the standard file
        existing_ds = None
        
        if os.path.exists(standard_data_file):
            try:
                # Load the existing dataset
                existing_ds = xr.open_dataset(standard_data_file)
                logger.info(f"Found existing dataset with {len(existing_ds.point)} points")
                
                # Create GeoDataFrame from existing points
                existing_points = gpd.GeoDataFrame(
                    geometry=[Point(lon, lat) for lon, lat in 
                            zip(existing_ds.longitude.values, existing_ds.latitude.values)],
                    data={
                        'class': existing_ds.label.values,
                        'id': existing_ds.point_id.values
                    },
                    crs="EPSG:4326"
                )
                
                # Find points that are not yet in the dataset
                points_gdf = self._get_uncached_points(points_gdf, existing_points)
                logger.info(f"After filtering out existing points, {len(points_gdf)} new points remain to be processed")
                
            except Exception as e:
                logger.error(f"Error loading existing dataset: {str(e)}")
                logger.warning("Creating a new dataset instead")
                existing_ds = None
        
        # If no points to process, return the existing file paths
        if len(points_gdf) == 0:
            logger.info("No new points to process, returning existing dataset")
            
            # If there's no existing dataset but also no points, create an empty one
            if existing_ds is None:
                logger.warning("No existing dataset and no points to process, creating empty dataset")
                empty_ds = self._create_empty_dataset()
                empty_ds.to_netcdf(standard_data_file)
                
                # Create metadata for empty dataset
                metadata = {
                    'collection': self.collection,
                    'chip_size': self.chip_size,
                    'num_chips': 0,
                    'extraction_time': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'last_updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }
                
                with open(standard_metadata_file, 'w') as f:
                    json.dump(metadata, f, indent=2)
            
            return standard_data_file, standard_metadata_file
        
        # Create the Earth Engine composite image for extraction
        try:
            self.create_image_collection(start_date, end_date, clear_threshold)
        except Exception as e:
            logger.error(f"Error creating image collection: {str(e)}")
            raise e
        
        # Set up multiprocessing for extraction
        if num_workers is None:
            import multiprocessing
            # Use n-1 cores to avoid overwhelming the system, but at least 1
            num_workers = max(1, multiprocessing.cpu_count() - 1)
            
        # Process all points
        logger.info(f"Starting extraction for {len(points_gdf)} points using {num_workers} workers")
        
        # Extract all chips
        chips = []
        labels = []
        
        point_data_list = [(idx, row) for idx, row in points_gdf.iterrows()]
        total_points = len(point_data_list)
        processed = 0
        
        # Use pool for parallel processing if more than one worker
        if num_workers > 1 and total_points > 1:
            import multiprocessing as mp
            from functools import partial
            
            with mp.Pool(num_workers) as pool:
                process_point_fn = partial(process_point_for_multiprocessing, 
                                          extractor=self, 
                                          start_date=start_date, 
                                          end_date=end_date)
                
                for idx, chip, label, success in pool.imap(process_point_fn, point_data_list):
                    processed += 1
                    
                    if progress_callback:
                        progress_callback(processed, total_points)
                    
                    if success:
                        chips.append(chip)
                        labels.append(label)
                        
                    logger.debug(f"Processed point {processed}/{total_points}")
        else:
            # Single-threaded processing
            for point_data in point_data_list:
                idx, chip, label, success = self._process_single_point(point_data, start_date, end_date)
                processed += 1
                
                if progress_callback:
                    progress_callback(processed, total_points)
                
                if success:
                    chips.append(chip)
                    labels.append(label)
                    
                logger.debug(f"Processed point {processed}/{total_points}")
        
        # Check if we have any valid chips
        if not chips:
            logger.warning("No valid chips were extracted for any points")
            # Return existing file or create empty one if needed
            if existing_ds is None:
                logger.warning("Creating empty dataset as no chips were extracted")
                empty_ds = self._create_empty_dataset()
                empty_ds.to_netcdf(standard_data_file)
                
                # Create metadata for empty dataset
                metadata = {
                    'collection': self.collection,
                    'chip_size': self.chip_size,
                    'num_chips': 0,
                    'extraction_time': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'last_updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }
                
                with open(standard_metadata_file, 'w') as f:
                    json.dump(metadata, f, indent=2)
            
            return standard_data_file, standard_metadata_file
        
        # Convert list of chips to numpy array
        chips_array = np.stack(chips)
        logger.info(f"Successfully extracted {len(chips)} chips")
        
        # Create xarray dataset for the newly extracted points
        points_with_data_gdf = points_gdf.iloc[[i for i, (idx, chip, label, success) in enumerate(zip(range(len(point_data_list)), chips, labels, [True] * len(chips))) if success]]
        
        # Get specific start_date and end_date for each point that was successfully processed
        point_start_dates = []
        point_end_dates = []
        
        for i, row in points_with_data_gdf.iterrows():
            # Use point-specific dates if available
            if 'start_date' in row and row['start_date']:
                point_start_dates.append(row['start_date'])
            else:
                point_start_dates.append(start_date)
                
            if 'end_date' in row and row['end_date']:
                point_end_dates.append(row['end_date'])
            else:
                point_end_dates.append(end_date)
        
        # Create dataset with the newly extracted points
        new_ds = self._create_xarray_dataset(chips_array, labels, points_with_data_gdf, start_date, end_date)
        
        # If we have an existing dataset, append the new data to it
        if existing_ds is not None:
            try:
                # Concatenate the existing and new datasets
                combined_ds = xr.concat([existing_ds, new_ds], dim='point')
                
                # Reset the point index to ensure it's sequential
                point_indices = np.arange(len(combined_ds.point))
                combined_ds = combined_ds.assign_coords(point=point_indices)
                
                # Close the existing dataset before overwriting the file
                existing_ds.close()
                
                # Save the combined dataset
                combined_ds.to_netcdf(standard_data_file)
                logger.info(f"Appended {len(new_ds.point)} new points to existing dataset, total: {len(combined_ds.point)}")
                
                # Update metadata
                metadata = {
                    'collection': self.collection,
                    'chip_size': self.chip_size,
                    'num_chips': len(combined_ds.point),
                    'extraction_time': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'last_updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }
            except Exception as e:
                logger.error(f"Error concatenating datasets: {str(e)}")
                # If concatenation fails, just use the new dataset
                new_ds.to_netcdf(standard_data_file)
                logger.warning(f"Saved only the new dataset with {len(new_ds.point)} points due to concatenation error")
                
                # Update metadata for new dataset only
                metadata = {
                    'collection': self.collection,
                    'chip_size': self.chip_size,
                    'num_chips': len(new_ds.point),
                    'extraction_time': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'last_updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }
        else:
            # Just save the new dataset
            new_ds.to_netcdf(standard_data_file)
            logger.info(f"Saved new dataset with {len(new_ds.point)} points")
            
            # Create metadata for new dataset
            metadata = {
                'collection': self.collection,
                'chip_size': self.chip_size,
                'num_chips': len(new_ds.point),
                'extraction_time': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'last_updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
        
        # Save metadata
        with open(standard_metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        return standard_data_file, standard_metadata_file
    
    def _create_empty_dataset(self):
        """Create an empty xarray dataset"""
        return xr.Dataset(
            data_vars={
                'chips': (('point', 'y', 'x', 'band'), np.zeros((0, self.chip_size, self.chip_size, len(self.band_ids)))),
                'label': (('point'), np.array([], dtype=str)),
                'longitude': (('point'), np.array([], dtype=np.float64)),
                'latitude': (('point'), np.array([], dtype=np.float64)),
                'point_id': (('point'), np.array([], dtype=str)),
                'start_date': (('point'), np.array([], dtype=str)),
                'end_date': (('point'), np.array([], dtype=str)),
                'clear_threshold': (('point'), np.array([], dtype=np.float32))
            },
            coords={
                'point': np.array([], dtype=np.int64),
                'y': np.arange(self.chip_size),
                'x': np.arange(self.chip_size),
                'band': self.band_ids
            },
            attrs={
                'collection': self.collection,
                'chip_size': self.chip_size,
                'crs': 'EPSG:4326'
            }
        )

    def _load_points(self, project_dir):
        """Helper method to load points from file."""
        # First try to look for points.geojson (new standard format)
        points_geojson_file = os.path.join(project_dir, 'points.geojson')
        points_json_file = os.path.join(project_dir, 'points.json')  # Older format
        
        points = []
        
        if os.path.exists(points_geojson_file):
            try:
                logger.info(f"Loading points from GeoJSON file: {points_geojson_file}")
                gdf = gpd.read_file(points_geojson_file)
                logger.info(f"Successfully loaded {len(gdf)} points from GeoJSON")
                return gdf
            except Exception as e:
                logger.error(f"Error loading points from GeoJSON: {str(e)}")
                # Fall back to loading from JSON if GeoJSON loading failed
        
        # If we're here, we need to load from the JSON file or there was an error with the GeoJSON
        try:
            if os.path.exists(points_json_file):
                logger.info(f"Loading points from JSON file: {points_json_file}")
                with open(points_json_file, 'r') as f:
                    points = json.load(f)
            elif os.path.exists(points_geojson_file):
                logger.info(f"Loading points from GeoJSON file as JSON: {points_geojson_file}")
                with open(points_geojson_file, 'r') as f:
                    geojson_data = json.load(f)
                    if 'features' in geojson_data:
                        points = geojson_data['features']
                    else:
                        logger.error("GeoJSON file does not contain a 'features' property")
                        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
            else:
                logger.error("No points file found")
                return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
        except Exception as e:
            logger.error(f"Error loading points: {str(e)}")
            return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
        
        # Create a list to store the data for each point
        data = []
        
        for point in points:
            # Extract coordinates and class from the points structure
            if 'geometry' in point and 'coordinates' in point['geometry']:
                coords = point['geometry']['coordinates']
                lng, lat = coords[0], coords[1]
                point_class = point.get('properties', {}).get('class', 'unknown')
                
                # Get point ID, ensuring it's a string
                point_id = ""
                if 'properties' in point and 'id' in point['properties']:
                    point_id = str(point['properties']['id'])
                
                # Extract time parameters if present
                properties = point.get('properties', {})
                start_date = properties.get('start_date', '')
                end_date = properties.get('end_date', '')
                clear_threshold = properties.get('clear_threshold', 0.75)
                
                # Add to data list
                data.append({
                    'geometry': Point(lng, lat),
                    'class': point_class,
                    'id': point_id,
                    'start_date': start_date,
                    'end_date': end_date,
                    'clear_threshold': clear_threshold
                })
            elif 'lng' in point and 'lat' in point:
                # Older format with lng/lat directly in the point
                lng, lat = point['lng'], point['lat']
                point_class = point.get('class', 'unknown')
                
                # Get point ID, ensuring it's a string
                point_id = ""
                if 'id' in point:
                    point_id = str(point['id'])
                
                # Add to data list
                data.append({
                    'geometry': Point(lng, lat),
                    'class': point_class,
                    'id': point_id,
                    'start_date': '',
                    'end_date': '',
                    'clear_threshold': 0.75
                })
        
        # Create GeoDataFrame with explicit CRS
        gdf = gpd.GeoDataFrame(data, crs="EPSG:4326")
        logger.info(f"Created GeoDataFrame with {len(gdf)} points and CRS: {gdf.crs}")
        
        return gdf

    def _create_xarray_dataset(self, chips_array, labels, points_gdf, start_date, end_date):
        """
        Create an xarray dataset from extracted chips
        
        Args:
            chips_array (np.ndarray): Array of extracted chips
            labels (list): List of labels for each chip
            points_gdf (GeoDataFrame): GeoDataFrame with points
            start_date (str): Start date
            end_date (str): End date
            
        Returns:
            xarray.Dataset: Dataset with chips, labels, and coordinates
        """
        num_chips = chips_array.shape[0]
        num_bands = chips_array.shape[-1]
        
        # Create coordinates
        lons = [geom.x for geom in points_gdf.geometry]
        lats = [geom.y for geom in points_gdf.geometry]
        
        # Extract point IDs if available
        point_ids = []
        if 'id' in points_gdf.columns:
            # Convert all IDs to strings for consistent handling
            point_ids = [str(pid) for pid in points_gdf['id'].tolist()]
            logger.info(f"Using {len(point_ids)} point IDs from GeoDataFrame")
        else:
            # Generate placeholder IDs if not available
            logger.warning("No 'id' column found in points_gdf, generating placeholder IDs")
            point_ids = [f"point_{i}" for i in range(num_chips)]
        
        # Get per-point start and end dates if available
        # If not in the GeoDataFrame, use the provided global start/end dates
        start_dates = []
        end_dates = []
        clear_thresholds = []
        
        for i in range(len(points_gdf)):
            # Default to global value if not present for a specific point
            if 'start_date' in points_gdf.columns:
                start_dates.append(points_gdf['start_date'].iloc[i])
            else:
                start_dates.append(start_date)
                
            if 'end_date' in points_gdf.columns:
                end_dates.append(points_gdf['end_date'].iloc[i])
            else:
                end_dates.append(end_date)
                
            if 'clear_threshold' in points_gdf.columns:
                clear_thresholds.append(float(points_gdf['clear_threshold'].iloc[i]))
            else:
                clear_thresholds.append(float(0.75))  # Default threshold
        
        # Ensure consistent data types for all variables
        # Convert labels to strings to avoid serialization issues
        labels_array = np.array([str(label) for label in labels])
        lons_array = np.array(lons, dtype=np.float64)
        lats_array = np.array(lats, dtype=np.float64)
        point_ids_array = np.array(point_ids, dtype=str)
        start_dates_array = np.array(start_dates, dtype=str)
        end_dates_array = np.array(end_dates, dtype=str)
        clear_thresholds_array = np.array(clear_thresholds, dtype=np.float32)
        
        # Create xarray dataset
        ds = xr.Dataset(
            data_vars={
                'chips': (('point', 'y', 'x', 'band'), chips_array),
                'label': (('point'), labels_array),
                'longitude': (('point'), lons_array),
                'latitude': (('point'), lats_array),
                'point_id': (('point'), point_ids_array),  # Add point_id as a data variable
                'start_date': (('point'), start_dates_array),  # Add per-point start date
                'end_date': (('point'), end_dates_array),  # Add per-point end date
                'clear_threshold': (('point'), clear_thresholds_array)  # Add per-point clear threshold
            },
            coords={
                'point': np.arange(num_chips),
                'y': np.arange(self.chip_size),
                'x': np.arange(self.chip_size),
                'band': self.band_ids
            },
            attrs={
                'collection': self.collection,
                'chip_size': self.chip_size,
                'crs': 'EPSG:4326'
            }
        )
        
        logger.info(f"Created xarray dataset with {num_chips} points and {num_bands} bands")
        
        return ds
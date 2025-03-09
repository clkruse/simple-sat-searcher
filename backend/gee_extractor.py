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

# Initialize logger
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Constants
BUFFER_SIZES = {
    'S2': 10,  # 10m resolution for Sentinel-2
    'S1': 10   # Standardized to 10m for Sentinel-1
}

BAND_IDS = {
    "S1": ["VV", "VH"],  
    "S2": ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8A", "B8", "B9", "B11", "B12"]
}

# Add this new standalone function for multiprocessing
def process_point_for_multiprocessing(args):
    """
    Standalone function to process a single point in a separate process.
    This function initializes Earth Engine for each worker process.
    
    Args:
        args (tuple): Tuple containing (point_data, collection, chip_size, ee_project, composite_params, start_date, end_date)
        
    Returns:
        tuple: (index, chip, label, success)
    """
    # Unpack arguments
    point_data, collection, chip_size, ee_project, composite_params, start_date, end_date = args
    idx, row = point_data
    
    try:
        # Initialize Earth Engine for this worker process
        import ee
        try:
            ee.Initialize(
                opt_url="https://earthengine-highvolume.googleapis.com",
                project=ee_project
            )
            logger.info("Earth Engine initialized successfully")
        except Exception as e:
            logger.error(f"Error initializing Earth Engine: {e}")
            return (idx, None, None, False)
        
        # Get label from row
        label = row.get('class', 'unknown')
        
        # Get resolution and bands
        resolution = BUFFER_SIZES.get(collection)
        band_ids = BAND_IDS.get(collection)
        
        # Create point geometry
        point = ee.Geometry.Point([row.geometry.x, row.geometry.y])
        
        # Create image collection and composite
        if collection == 'S2':
            s2 = ee.ImageCollection("COPERNICUS/S2_HARMONIZED")
            clear_threshold = composite_params.get('clear_threshold', 0.75)

            # Cloud Score+ from L1C data; can be applied to L1C or L2A.
            csPlus = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
            QA_BAND = "cs_cdf"

            composite = (
                s2.filterDate(start_date, end_date)
                .linkCollection(csPlus, [QA_BAND])
                .map(lambda img: img.updateMask(img.select(QA_BAND).gte(clear_threshold)))
                .median())

        elif collection == 'S1':
            s1 = ee.ImageCollection("COPERNICUS/S1_GRD")
            composite = (
                s1.filterDate(start_date, end_date)
                .filter(ee.Filter.eq('instrumentMode', 'IW'))
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                .mosaic())
        else:
            raise ValueError(f'Collection {collection} not recognized.')
        
        # Calculate buffer distance in meters
        buffer_meters = resolution * chip_size / 2
        
        # Buffer the point
        buffered_point = point.buffer(buffer_meters)
        
        # Extract the chip
        chip = composite.clipToBoundsAndScale(
            geometry=buffered_point, 
            width=chip_size, 
            height=chip_size
        )
        
        try:
            # Get the pixels
            pixels = ee.data.computePixels({
                "bandIds": band_ids,
                "expression": chip,
                "fileFormat": "NUMPY_NDARRAY",
            })
            
            # Convert from a structured array to a numpy array
            pixels = np.array(pixels.tolist())
            
            return (idx, pixels, label, True)
            
        except Exception as e:
            logger.error(f"Error extracting chip at ({row.geometry.x}, {row.geometry.y}): {e}")
            return (idx, None, None, False)
            
    except Exception as e:
        logger.error(f"Error extracting chip for point {idx+1}: {e}")
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
        self.resolution = BUFFER_SIZES.get(collection)
        
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

    def extract_chips_for_project(self, start_date, end_date, clear_threshold=0.75, progress_callback=None, num_workers=None):
        """
        Extract chips for all points in a project
        
        Args:
            start_date (str): Start date in format 'YYYY-MM-DD'
            end_date (str): End date in format 'YYYY-MM-DD'
            clear_threshold (float): Threshold for cloud cover (0-1)
            progress_callback (callable): Optional callback function for progress updates
            num_workers (int): Number of worker processes to use. If None, uses CPU count - 1
            
        Returns:
            tuple: (output_file, metadata_file) paths
        """
        # Get the project directory
        project_dir = os.path.join("projects", self.project_id)
        if not os.path.exists(project_dir):
            raise FileNotFoundError(f"Project directory {project_dir} not found")
        
        # Create output directory for extracted data
        output_dir = os.path.join(project_dir, "extracted_data")
        os.makedirs(output_dir, exist_ok=True)
        
        # Define standard filenames for consistent data storage
        standard_data_file = os.path.join(output_dir, f"{self.collection}_{self.chip_size}px_extracted_data.nc")
        standard_metadata_file = os.path.join(output_dir, f"{self.collection}_{self.chip_size}px_metadata.json")
        
        # Load points from file - should use points.geojson now
        points_gdf = self._load_points(project_dir)
        
        # Ensure the GeoDataFrame has a CRS
        if points_gdf.crs is None:
            points_gdf.set_crs("EPSG:4326", inplace=True)
            logger.warning("Points GeoDataFrame had no CRS, setting to EPSG:4326")
        
        # Check for existing data in the standard file
        cached_ds = None
        cached_metadata = None
        
        if os.path.exists(standard_data_file) and os.path.exists(standard_metadata_file):
            try:
                # Load the existing dataset
                cached_ds = xr.open_dataset(standard_data_file)
                
                # Load the existing metadata
                with open(standard_metadata_file, 'r') as f:
                    cached_metadata = json.load(f)
                
                # Create GeoDataFrame from cached points
                cached_points = gpd.GeoDataFrame(
                    geometry=[Point(lon, lat) for lon, lat in 
                            zip(cached_ds.longitude.values, cached_ds.latitude.values)],
                    data={'class': cached_ds.label.values},
                    crs="EPSG:4326"
                )
            except Exception as e:
                logger.warning(f"Error reading existing data: {e}")
                cached_ds = None
                cached_metadata = None
                cached_points = None
        else:
            cached_points = None
        
        # Get points that need to be extracted
        points_to_extract = self._get_uncached_points(points_gdf, cached_points)
        
        # Ensure the points_to_extract GeoDataFrame has a CRS
        if points_to_extract is not None and len(points_to_extract) > 0 and points_to_extract.crs is None:
            points_to_extract.set_crs(points_gdf.crs, inplace=True)
            logger.warning("points_to_extract GeoDataFrame had no CRS, copying from original points")
        
        if len(points_to_extract) == 0 and cached_ds is not None:
            logger.info("All points found in cache, reusing existing dataset")
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            
            # Get number of points from cached dataset
            num_points = len(cached_ds.point)
            
            # Make sure to close the cached dataset
            cached_ds.close()
            
            # Update the metadata with the reuse information
            if cached_metadata:
                cached_metadata["last_checked"] = timestamp
                with open(standard_metadata_file, 'w') as f:
                    json.dump(cached_metadata, f, indent=2)
            
            return standard_data_file, standard_metadata_file
        
        # Create the image collection for new points
        if len(points_to_extract) > 0:
            # We'll create image collections in each worker process instead
            # Just prepare the composite parameters
            composite_params = {
                'clear_threshold': clear_threshold
            }
        
        # Extract chips for new points using multiprocessing
        new_chips = []
        new_labels = []
        new_points = []
        
        total_points = len(points_to_extract)
        
        # Determine number of workers
        if num_workers is None:
            num_workers = max(1, multiprocessing.cpu_count() - 1)
        
        # Create a progress counter for callback
        processed_count = 0
        
        if total_points > 0:
            # Reset the index of points_to_extract to ensure contiguous indices
            points_to_extract = points_to_extract.reset_index(drop=True)
            
            # Process points in parallel
            with multiprocessing.Pool(processes=num_workers) as pool:
                # Create an iterator of arguments for each point
                point_data_iter = points_to_extract.iterrows()
                
                # Ensure each row has the CRS information
                args_iter = []
                for point_data in point_data_iter:
                    idx, row = point_data
                    # Create a copy of the row with explicit CRS information
                    # This ensures the CRS is available in the worker process
                    args_iter.append((
                        (idx, row), 
                        self.collection, 
                        self.chip_size, 
                        self.ee_project, 
                        composite_params, 
                        start_date,
                        end_date
                    ))
                
                # Use imap to process points and get immediate results
                for idx, chip_data, label, success in pool.imap(process_point_for_multiprocessing, args_iter):
                    processed_count += 1
                    
                    if success:
                        new_chips.append(chip_data)
                        new_labels.append(label)
                        
                        # Keep track of the actual point - get from the original DataFrame
                        point_row = points_to_extract.iloc[idx]
                        point_data = {
                            'geometry': point_row.geometry,
                            'class': point_row['class']
                        }
                        
                        # Add point ID if available
                        if 'id' in point_row:
                            point_data['id'] = point_row['id']
                        else:
                            logger.warning(f"No ID found for point {idx}")
                        
                        new_points.append(point_data)
                    
                    if progress_callback:
                        progress_callback(processed_count, total_points)
                    
                    logger.info(f"Processed chip {processed_count}/{total_points}")
        
        # Create a GeoDataFrame from the successful points
        if new_points:
            successful_points = gpd.GeoDataFrame(new_points, crs=points_gdf.crs)
            logger.info(f"Created successful_points GeoDataFrame with {len(successful_points)} points")
        else:
            successful_points = gpd.GeoDataFrame(geometry=[], crs=points_gdf.crs)
            logger.warning("No successful points to create GeoDataFrame")
        
        # Combine new data with cached data if available
        if cached_ds is not None and len(new_chips) > 0:
            # Convert new data to xarray
            new_chips_array = np.stack(new_chips)
            new_ds = self._create_xarray_dataset(new_chips_array, new_labels, 
                                               successful_points, start_date, end_date)
            
            # Combine datasets
            ds = xr.concat([cached_ds, new_ds], dim='point')
            
            # Make sure to close the cached dataset
            cached_ds.close()
            new_ds.close()
        elif cached_ds is not None:
            ds = cached_ds.copy(deep=True)
            cached_ds.close()
        elif len(new_chips) > 0:
            # Convert to xarray
            new_chips_array = np.stack(new_chips)
            ds = self._create_xarray_dataset(new_chips_array, new_labels, 
                                           successful_points, start_date, end_date)
        else:
            raise ValueError("No chips were extracted successfully")
        
        # Save the combined dataset to the standard file
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        num_points = len(ds.point)
        
        # Create a temporary file first, then rename it to avoid issues with partially written files
        temp_data_file = os.path.join(output_dir, f"temp_{timestamp}_{self.collection}_{self.chip_size}px_extracted_data.nc")
        
        try:
            # Save to temporary file first
            ds.to_netcdf(temp_data_file)
            
            # Close the dataset before moving the file
            ds.close()
            
            # Verify that the data was saved correctly
            try:
                # Open the temporary file to check if point_id was saved correctly
                verification_ds = xr.open_dataset(temp_data_file)
                if 'point_id' not in verification_ds:
                    logger.error(f"Verification failed: point_id variable not found in saved file")
                verification_ds.close()
            except Exception as e:
                logger.error(f"Error verifying saved file: {e}")
            
            # Make sure the target file doesn't exist (could happen if there was a previous attempt)
            if os.path.exists(standard_data_file):
                try:
                    # Directly remove the existing file instead of creating a backup
                    os.remove(standard_data_file)
                    logger.info(f"Removed existing data file: {standard_data_file}")
                except OSError as e:
                    logger.error(f"Could not remove existing file: {e}")
                    raise ValueError(f"Could not replace existing file: {standard_data_file}. It may be in use by another process.")
            
            # Now rename the temp file to the standard file name
            os.rename(temp_data_file, standard_data_file)
            
        except Exception as e:
            logger.error(f"Error saving dataset: {e}")
            # Clean up temp file if it exists
            if os.path.exists(temp_data_file):
                try:
                    os.remove(temp_data_file)
                except:
                    pass
            raise e
        
        # Update metadata
        metadata = {
            "collection": self.collection,
            "start_date": start_date,
            "end_date": end_date,
            "clear_threshold": clear_threshold,
            "chip_size": self.chip_size,
            "num_chips": num_points,
            "num_cached_chips": len(cached_ds.point) if cached_ds is not None else 0,
            "num_new_chips": len(new_chips),
            "bands": self.band_ids,
            "last_updated": timestamp,
            "num_workers": num_workers
        }
        
        # Save metadata to a temporary file first
        temp_metadata_file = os.path.join(output_dir, f"temp_{timestamp}_metadata.json")
        
        try:
            with open(temp_metadata_file, 'w') as f:
                json.dump(metadata, f, indent=2)
                
            # Make sure the target file doesn't exist
            if os.path.exists(standard_metadata_file):
                try:
                    os.remove(standard_metadata_file)
                except OSError:
                    pass
                    
            # Rename the temp file to the standard metadata file
            os.rename(temp_metadata_file, standard_metadata_file)
        except Exception as e:
            logger.error(f"Error saving metadata: {e}")
            # Clean up temp file if it exists
            if os.path.exists(temp_metadata_file):
                try:
                    os.remove(temp_metadata_file)
                except:
                    pass
            raise e
        
        return standard_data_file, standard_metadata_file

    def _load_points(self, project_dir):
        """Helper method to load points from file."""
        # Look for points.geojson file
        points_file = os.path.join(project_dir, "points.geojson")
        
        if not os.path.exists(points_file):
            logger.warning(f"No points.geojson file found in {project_dir}")
            # Try to find any other GeoJSON files
            geojson_files = [f for f in os.listdir(project_dir) if f.endswith('.geojson')]
            if not geojson_files:
                logger.error(f"No GeoJSON files found in {project_dir}")
                raise FileNotFoundError(f"No point data found in {project_dir}")
            
            # Use the most recent GeoJSON file
            points_file = os.path.join(project_dir, geojson_files[0])
            logger.info(f"Using {points_file} for points")
        
        # Load the GeoJSON file
        try:
            with open(points_file, 'r') as f:
                geojson = json.load(f)
                
            # Check if it's a valid GeoJSON with features
            if 'features' not in geojson:
                logger.error(f"Invalid GeoJSON file: {points_file} - no features found")
                raise ValueError(f"Invalid GeoJSON file: {points_file} - no features found")
                
            points = geojson['features']
            logger.info(f"Loaded {len(points)} points from {points_file}")
            
            # Check if points have IDs
            has_ids = sum(1 for p in points if 'properties' in p and 'id' in p.get('properties', {}))
            if has_ids < len(points):
                logger.warning(f"Only {has_ids} of {len(points)} points have IDs")
                
        except Exception as e:
            logger.error(f"Error loading points from {points_file}: {e}")
            raise e
        
        # Convert points.json to GeoDataFrame
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
                
                # Add to data list
                data.append({
                    'geometry': Point(lng, lat),
                    'class': point_class,
                    'id': point_id
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
                    'id': point_id
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
        
        # Create xarray dataset
        ds = xr.Dataset(
            data_vars={
                'chips': (('point', 'y', 'x', 'band'), chips_array),
                'label': (('point'), labels),
                'longitude': (('point'), lons),
                'latitude': (('point'), lats),
                'point_id': (('point'), point_ids)  # Add point_id as a data variable
            },
            coords={
                'point': np.arange(num_chips),
                'y': np.arange(self.chip_size),
                'x': np.arange(self.chip_size),
                'band': self.band_ids
            },
            attrs={
                'collection': self.collection,
                'start_date': start_date,
                'end_date': end_date,
                'chip_size': self.chip_size,
                'crs': 'EPSG:4326'
            }
        )
        
        logger.info(f"Created xarray dataset with {num_chips} points and {num_bands} bands")
        
        return ds
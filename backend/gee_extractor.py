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
        args (tuple): Tuple containing (point_data, collection, chip_size, ee_project, composite, resolution, band_ids, start_date, end_date)
        
    Returns:
        tuple: (index, chip, label, success)
    """
    # Unpack arguments
    point_data, collection, chip_size, ee_project, composite_params, resolution, band_ids, start_date, end_date = args
    idx, row = point_data
    
    try:
        # Initialize Earth Engine for this process
        ee.Initialize(
            opt_url="https://earthengine-highvolume.googleapis.com",
            project=ee_project,
        )
        
        # Get the geometry and validate it
        if not hasattr(row, 'geometry') or row.geometry is None:
            print(f"Error: Point {idx} has no geometry")
            return (idx, None, None, False)
        
        geometry = row.geometry
        
        # Validate coordinates
        if not hasattr(geometry, 'x') or not hasattr(geometry, 'y'):
            print(f"Error: Point {idx} geometry has no x/y attributes")
            return (idx, None, None, False)
        
        # Create a point directly from coordinates
        lon, lat = geometry.x, geometry.y
        point = ee.Geometry.Point([lon, lat])
        
        # Create image collection for this point
        if collection == 'S2':
            s2 = ee.ImageCollection("COPERNICUS/S2_HARMONIZED")
            csPlus = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
            
            # Filter by date
            s2_filtered = s2.filterDate(start_date, end_date)
            csPlus_filtered = csPlus.filterDate(start_date, end_date)
            
            # Join collections
            joined = ee.Join.saveFirst('csplus').apply(
                primary=s2_filtered,
                secondary=csPlus_filtered,
                condition=ee.Filter.equals(
                    leftField='system:index',
                    rightField='system:index'
                )
            )
            
            # Apply cloud mask
            clear_threshold = composite_params.get('clear_threshold', 0.75)
            withCloudScore = ee.ImageCollection(joined).map(
                lambda img: img.updateMask(
                    ee.Image(img.get('csplus')).select('cs').gt(clear_threshold)
                )
            )
            
            # Create composite
            composite = withCloudScore.select(band_ids).median()
            
        elif collection == 'S1':
            s1 = ee.ImageCollection("COPERNICUS/S1_GRD")
            
            # Filter by date and polarization
            s1_filtered = s1.filterDate(start_date, end_date) \
                .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV')) \
                .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH')) \
                .filter(ee.Filter.eq('instrumentMode', 'IW'))
            
            # Create composite
            composite = s1_filtered.select(band_ids).median()
        else:
            raise ValueError(f"Unsupported collection: {collection}")
        
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
            
            # Validate the class attribute
            if not hasattr(row, 'class') or row['class'] is None:
                print(f"Warning: Point {idx} has no class attribute, using 'unknown'")
                point_class = 'unknown'
            else:
                point_class = row['class']
            
            return (idx, pixels, point_class, True)
        except Exception as e:
            print(f"Error computing pixels for point {idx}: {e}")
            return (idx, None, None, False)
        
    except Exception as e:
        print(f"Error processing point {idx}: {str(e)}")
        # Print more details about the row to help debug
        try:
            print(f"Point details - idx: {idx}, geometry type: {type(row.geometry)}, "
                  f"coordinates: ({row.geometry.x}, {row.geometry.y}), "
                  f"class: {row.get('class', 'unknown')}")
        except:
            print(f"Could not print point details for idx {idx}")
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
        
        # Load points from file
        points_gdf = self._load_points(project_dir)
        
        # Ensure the GeoDataFrame has a CRS
        if points_gdf.crs is None:
            points_gdf.set_crs("EPSG:4326", inplace=True)
            logger.warning("Points GeoDataFrame had no CRS, setting to EPSG:4326")
        
        # Check for matching cached data
        cached_points, cached_ds, cached_metadata = self._find_matching_cache(
            points_gdf, start_date, end_date, output_dir)
        
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
            
            # Create more descriptive filenames including datapoints and resolution
            output_file = os.path.join(
                output_dir, 
                f"{self.collection}_{start_date}_{end_date}_{num_points}pts_{self.chip_size}px_{timestamp}.nc"
            )
            metadata_file = os.path.join(
                output_dir, 
                f"{self.collection}_{start_date}_{end_date}_{num_points}pts_{self.chip_size}px_{timestamp}_metadata.json"
            )
            
            # Save the cached dataset with new timestamp
            cached_ds.to_netcdf(output_file)
            
            # Update and save metadata
            if cached_metadata:
                cached_metadata["extraction_time"] = timestamp
                cached_metadata["reused_from_cache"] = True
                with open(metadata_file, 'w') as f:
                    json.dump(cached_metadata, f, indent=2)
            
            return output_file, metadata_file
        
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
                        self.resolution, 
                        self.band_ids, 
                        start_date, 
                        end_date
                    ))
                
                # Process points in parallel and handle results as they complete
                for idx, chip, label, success in pool.imap_unordered(process_point_for_multiprocessing, args_iter):
                    processed_count += 1
                    
                    if success:
                        new_chips.append(chip)
                        new_labels.append(label)
                        new_points.append(points_to_extract.iloc[idx])
                    
                    if progress_callback:
                        progress_callback(processed_count, total_points)
                    
                    logger.info(f"Processed chip {processed_count}/{total_points}")
        
        # Create a GeoDataFrame from the successful points
        if new_points:
            successful_points = gpd.GeoDataFrame(new_points, crs=points_gdf.crs)
        else:
            successful_points = gpd.GeoDataFrame(geometry=[], crs=points_gdf.crs)
        
        # Combine new data with cached data if available
        if cached_ds is not None and len(new_chips) > 0:
            # Convert new data to xarray
            new_chips_array = np.stack(new_chips)
            new_ds = self._create_xarray_dataset(new_chips_array, new_labels, 
                                               successful_points, start_date, end_date)
            
            # Combine datasets
            ds = xr.concat([cached_ds, new_ds], dim='point')
        elif cached_ds is not None:
            ds = cached_ds
        elif len(new_chips) > 0:
            # Convert to xarray
            new_chips_array = np.stack(new_chips)
            ds = self._create_xarray_dataset(new_chips_array, new_labels, 
                                           successful_points, start_date, end_date)
        else:
            raise ValueError("No chips were extracted successfully")
        
        # Save the combined dataset
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        num_points = len(ds.point)
        output_file = os.path.join(
            output_dir, 
            f"{self.collection}_{start_date}_{end_date}_{num_points}pts_{self.chip_size}px_{timestamp}.nc"
        )
        ds.to_netcdf(output_file)
        
        # Save metadata
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
            "extraction_time": timestamp,
            "num_workers": num_workers
        }
        
        metadata_file = os.path.join(
            output_dir, 
            f"{self.collection}_{start_date}_{end_date}_{num_points}pts_{self.chip_size}px_{timestamp}_metadata.json"
        )
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        return output_file, metadata_file

    def _load_points(self, project_dir):
        """Helper method to load points from file."""
        # First try to find a geojson file (for backward compatibility)
        geojson_files = [f for f in os.listdir(project_dir) if f.endswith('.geojson')]
        
        if geojson_files:
            # Use existing GeoJSON if available
            latest_file = sorted(geojson_files)[-1]
            file_path = os.path.join(project_dir, latest_file)
            gdf = gpd.read_file(file_path)
            
            # Ensure the GeoDataFrame has a CRS
            if gdf.crs is None:
                gdf.set_crs("EPSG:4326", inplace=True)
                logger.warning(f"GeoDataFrame from {latest_file} had no CRS, setting to EPSG:4326")
            
            return gdf
        
        # Look for points.json
        points_path = os.path.join(project_dir, 'points.json')
        if not os.path.exists(points_path):
            raise FileNotFoundError(f"No points found in {project_dir}")
        
        # Read the points.json file
        with open(points_path, 'r') as f:
            points = json.load(f)
        
        if not points:
            raise ValueError(f"No points found in {points_path}")
        
        # Convert points.json to GeoDataFrame
        data = []
        for point in points:
            # Extract coordinates and class from the points structure
            if 'geometry' in point and 'coordinates' in point['geometry']:
                coords = point['geometry']['coordinates']
                lng, lat = coords[0], coords[1]
                point_class = point.get('properties', {}).get('class', 'unknown')
                
                # Add to data list
                data.append({
                    'geometry': Point(lng, lat),
                    'class': point_class,
                    'id': point.get('properties', {}).get('id', '')
                })
            elif 'lng' in point and 'lat' in point:
                # Older format with lng/lat directly in the point
                lng, lat = point['lng'], point['lat']
                point_class = point.get('class', 'unknown')
                
                # Add to data list
                data.append({
                    'geometry': Point(lng, lat),
                    'class': point_class,
                    'id': point.get('id', '')
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
        
        # Create xarray dataset
        ds = xr.Dataset(
            data_vars={
                'chips': (('point', 'y', 'x', 'band'), chips_array),
                'label': (('point'), labels),
                'longitude': (('point'), lons),
                'latitude': (('point'), lats)
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
        
        return ds
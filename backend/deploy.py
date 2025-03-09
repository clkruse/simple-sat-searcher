import ee
import os
import json
import logging
import numpy as np
import geopandas as gpd
from shapely.geometry import Polygon
import datetime
import concurrent.futures
import traceback

# Constants
PROJECTS_DIR = "projects"
BUFFER_SIZES = {
    'S2': 10,  # 10m resolution for Sentinel-2
    'S1': 10   # 10m resolution for Sentinel-1
}

# Band IDs for different collections
BAND_IDS = {
    "S1": ["VV", "VH"],  
    "S2": ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8A", "B8", "B9", "B11", "B12"]
}

# Normalization constants for Sentinel-2
S2_MEANS = [1405.8951, 1175.9235, 1172.4902, 1091.9574, 1321.1304, 2181.5363, 
            2670.2361, 2491.2354, 2948.3846, 420.1552, 2028.0025, 1076.2417]
S2_DEVIATIONS = [291.9438, 398.5558, 504.557, 748.6153, 651.8549, 730.9811, 
                913.6062, 893.9428, 1055.297, 225.2153, 970.1915, 752.8637]

class ModelDeployer:
    def __init__(self, project_id, collection='S2', chip_size=576, ee_project="earth-engine-ck"):
        """Initialize the model deployer.
        
        Args:
            project_id (str): The project ID
            collection (str): The satellite collection to use (default: 'S2')
            chip_size (int): Size of each chip in pixels (default: 576)
            ee_project (str): Google Earth Engine project ID (default: "earth-engine-ck")
        """
        self.project_id = project_id
        self.collection = collection
        self.chip_size = chip_size
        self.ee_project = ee_project
        self.logger = logging.getLogger(__name__)
        
        # Initialize Earth Engine
        try:
            ee.Initialize(
                opt_url="https://earthengine-highvolume.googleapis.com",
                project=ee_project,
            )
            self.logger.info("Earth Engine initialized successfully")
        except Exception as e:
            self.logger.error(f"Failed to initialize Earth Engine: {e}")
            raise e
    
    def get_satellite_collection(self, start_date, end_date):
        """Get the satellite collection based on the specified collection type."""
        if self.collection == 'S2':
            s2 = ee.ImageCollection("COPERNICUS/S2_HARMONIZED")
            # Cloud Score+ from L1C data; can be applied to L1C or L2A.
            csPlus = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
            QA_BAND = "cs_cdf"
            
            # Create the composite image - this is done lazily now and will be evaluated when needed
            filtered_collection = s2.filterDate(start_date, end_date)
            self.composite = (
                filtered_collection
                .linkCollection(csPlus, [QA_BAND])
                .map(lambda img: img.updateMask(img.select(QA_BAND).gte(0.75)))
                .median()
            )
            
            # Return the collection for size check
            return filtered_collection
            
        elif self.collection == 'S1':
            s1 = ee.ImageCollection("COPERNICUS/S1_GRD")
            # Create the composite image - done lazily
            filtered_collection = s1.filterDate(start_date, end_date)
            self.composite = (
                filtered_collection
                .filter(ee.Filter.eq('instrumentMode', 'IW'))
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                .mosaic()
            )
            
            # Return the collection for size check
            return filtered_collection
        else:
            raise ValueError(f'Collection {self.collection} not recognized.')
    
    def get_region_bounds(self, region):
        """Convert GeoJSON region to Earth Engine geometry."""
        if isinstance(region, dict):
            # Convert GeoJSON to ee.Geometry
            if region['type'] == 'Polygon':
                coordinates = region['coordinates'][0]  # Get first ring
                return ee.Geometry.Polygon(coordinates)
            elif region['type'] == 'MultiPolygon':
                return ee.Geometry.MultiPolygon(region['coordinates'])
        return region
    
    def load_model_metadata(self, model_path):
        """Load model metadata to get input shape and other information.
        
        Args:
            model_path (str): Path to the model file
            
        Returns:
            dict: Model metadata
        """
        metadata_path = model_path.replace('.h5', '_metadata.json')
        if not os.path.exists(metadata_path):
            raise FileNotFoundError(f"Model metadata not found at {metadata_path}")
            
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
            
        return metadata
    
    def normalize_data(self, data, collection):
        """Normalize data using the same method as in training."""
        if collection == 'S2':
            # Use the same normalization as in gee_extractor
            return np.clip(data.astype("float32") / 10000, 0, 1)
        elif self.collection == 'S1':
            return data / 100.0  # Simple scaling for Sentinel-1
        return data
    
    def export_tile_boundaries(self, tiles, output_dir):
        """Export tile boundaries as GeoJSON for debugging.
        
        Args:
            tiles (list): List of tile geometries
            output_dir (str): Directory to save the output
        """
        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        output_file = os.path.join(output_dir, f'tile_boundaries_{timestamp}.geojson')
        
        # Convert tiles to GeoDataFrame
        tile_geoms = [ee.Geometry.Rectangle(tile.bounds).getInfo() for tile in tiles]
        gdf = gpd.GeoDataFrame(geometry=[Polygon(geom['coordinates'][0]) for geom in tile_geoms], crs="EPSG:4326")
        
        # Save to file
        gdf.to_file(output_file, driver='GeoJSON')
        self.logger.info(f"Saved tile boundaries to {output_file}")
        return output_file

    def export_chip_boundaries(self, chip_geoms, output_dir):
        """Export chip boundaries as GeoJSON for debugging.
        
        Args:
            chip_geoms (list): List of chip geometries
            output_dir (str): Directory to save the output
        """
        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        output_file = os.path.join(output_dir, f'chip_boundaries_{timestamp}.geojson')
        
        # Convert to GeoDataFrame
        gdf = gpd.GeoDataFrame(geometry=chip_geoms, crs="EPSG:4326")
        
        # Save to file
        gdf.to_file(output_file, driver='GeoJSON')
        self.logger.info(f"Saved chip boundaries to {output_file}")
        return output_file

    def save_chip_data(self, chips, output_dir):
        """Save chip data for debugging.
        
        Args:
            chips (list): List of numpy arrays containing chip data
            output_dir (str): Directory to save the output
        """
        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        output_file = os.path.join(output_dir, f'chip_data_{timestamp}.npy')
        
        # Stack chips into a single array
        chips_array = np.stack(chips)
        
        # Save to file
        np.save(output_file, chips_array)
        self.logger.info(f"Saved chip data to {output_file}")
        return output_file

    def _process_tile(self, tile_info, model, pred_threshold, tries):
        """Process a single tile and return prediction results.
        
        Args:
            tile_info: Tuple containing (x, y, coords, tile_geom)
            model: The model to use for predictions
            pred_threshold: Prediction confidence threshold
            tries: Number of retries for Earth Engine requests
            
        Returns:
            List of geometries and confidences for predictions that meet the threshold
        """
        x, y, coords, tile_geom = tile_info
        geometries = []
        confidences = []
        
        # Get image data for this tile
        image_data = None
        for attempt in range(tries):
            try:
                # Clip and scale the image to the tile geometry
                clipped_image = self.composite.clipToBoundsAndScale(
                    geometry=tile_geom,
                    width=self.chip_size + 2,  # Add padding
                    height=self.chip_size + 2
                )
                
                # Get the data using computePixels with specific band IDs
                pixels = ee.data.computePixels({
                    "expression": clipped_image,
                    "fileFormat": "NUMPY_NDARRAY",
                    "bandIds": BAND_IDS[self.collection]
                })
                
                # Convert from structured array to numpy array
                image_data = np.array(pixels.tolist())
                
                # Ensure the data is in the correct format (height, width, channels)
                if len(image_data.shape) == 2:
                    image_data = image_data.reshape(image_data.shape[0], image_data.shape[1], -1)
                
                # Normalize the data
                image_data = self.normalize_data(image_data, self.collection)
                break
            except Exception as e:
                if attempt == tries - 1:
                    self.logger.warning(f"Failed to get data for tile at ({x}, {y}): {str(e)}")
                    return [], []
                continue
        
        if image_data is None:
            return [], []
        
        # Process the image data
        try:
            # Get the model's expected input shape from the model itself
            input_shape = model.input_shape[1:]  # Remove batch dimension
            chip_size = input_shape[0]  # Use the model's expected size
            
            # Break down the tile into chips
            stride = chip_size // 2  # 50% overlap between chips
            
            # Create chips and their geometries
            chips = []
            chip_geoms = []
            
            # Calculate valid ranges for chip extraction
            valid_height = image_data.shape[0] - chip_size
            valid_width = image_data.shape[1] - chip_size
            
            # Extract lon/lat info from tile_info
            lon_min, lat_min, lon_max, lat_max = coords[0][0], coords[0][1], coords[2][0], coords[2][1]
            
            # Calculate pixel sizes in degrees
            delta_x = lon_max - lon_min
            delta_y = lat_max - lat_min
            x_per_pixel = delta_x / image_data.shape[1]
            y_per_pixel = delta_y / image_data.shape[0]
            
            # Extract chips with proper bounds checking
            for i in range(0, valid_height + 1, stride):
                for j in range(0, valid_width + 1, stride):
                    # Extract chip
                    patch = image_data[i:i + chip_size, j:j + chip_size]
                    
                    # Verify chip shape
                    if patch.shape != input_shape:
                        continue
                    
                    # Calculate the center point of the chip
                    center_lon = lon_min + (j + chip_size / 2) * x_per_pixel
                    center_lat = lat_max - (i + chip_size / 2) * y_per_pixel
                    
                    # Calculate the actual meters per degree at this latitude
                    meters_per_degree_lat = 111320  # meters per degree latitude (approximately constant)
                    meters_per_degree_lon = 111320 * np.cos(center_lat * np.pi / 180)  # meters per degree longitude
                    
                    # Calculate half-width of chip in meters
                    half_size_meters = (chip_size / 2) * BUFFER_SIZES[self.collection]
                    
                    # Convert to degrees with correction for latitude
                    half_size_lat_degrees = half_size_meters / meters_per_degree_lat
                    half_size_lon_degrees = half_size_meters / meters_per_degree_lon
                    
                    # Create polygon coordinates that will appear square on the map
                    nw_coord = [center_lon - half_size_lon_degrees, center_lat + half_size_lat_degrees]
                    ne_coord = [center_lon + half_size_lon_degrees, center_lat + half_size_lat_degrees]
                    se_coord = [center_lon + half_size_lon_degrees, center_lat - half_size_lat_degrees]
                    sw_coord = [center_lon - half_size_lon_degrees, center_lat - half_size_lat_degrees]
                    
                    # Create polygon for this chip
                    chip_geom = Polygon([nw_coord, ne_coord, se_coord, sw_coord, nw_coord])
                    
                    chips.append(patch)
                    chip_geoms.append(chip_geom)
            
            # Process chips in batches
            if chips:
                # Stack chips into a single array
                chips_array = np.stack(chips)
                
                # Make predictions
                predictions = model.predict(chips_array)
                
                # Process predictions
                for pred, chip_geom in zip(predictions, chip_geoms):
                    # Handle different prediction shapes
                    if isinstance(pred, np.ndarray):
                        if len(pred.shape) > 1:
                            pred_value = pred[0][0] if pred.shape[1] > 1 else pred[0]
                        else:
                            pred_value = pred[0]
                    else:
                        pred_value = float(pred)
                        
                    if pred_value >= pred_threshold:
                        # Use the bounding box polygon directly
                        geometries.append(chip_geom)
                        confidences.append(float(pred_value))
        
        except Exception as e:
            self.logger.warning(f"Error processing tile at ({x}, {y}): {str(e)}")
            return [], []
            
        return geometries, confidences

    def make_predictions(self, model, region, start_date, end_date, 
                        pred_threshold=0.5, clear_threshold=0.75,
                        tile_padding=24, batch_size=500, tries=2,
                        progress_callback=None):
        """Make predictions using the trained model."""
        try:
            # Create predictions directory if it doesn't exist
            predictions_dir = os.path.join(PROJECTS_DIR, self.project_id, 'predictions')
            os.makedirs(predictions_dir, exist_ok=True)
            
            # Generate a unique filename based on timestamp
            timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
            output_file = os.path.join(predictions_dir, f'predictions_{timestamp}.geojson')
            
            # Get satellite collection and check for images - optimized to reduce Earth Engine API calls
            self.logger.info(f"Retrieving {self.collection} collection for date range {start_date} to {end_date}")
            
            # Initialize the satellite collection and composite image
            collection = self.get_satellite_collection(start_date, end_date)
            
            # Convert region to ee.Geometry
            self.logger.info("Converting input region to Earth Engine geometry")
            region_ee = self.get_region_bounds(region)
            
            # Use the composite image for processing - already created in get_satellite_collection
            self.logger.info("Creating composite image from collection")
            
            self.logger.info(f"Successfully created composite image with bands: {BAND_IDS[self.collection]}")
            self.logger.info("Successfully converted region to Earth Engine geometry")
            
            # Use predefined scale from BUFFER_SIZES
            scale = BUFFER_SIZES[self.collection]
            self.logger.info(f"Using scale: {scale} meters per pixel")
            
            # Get region bounds
            bounds = region_ee.bounds().getInfo()
            coords = bounds['coordinates'][0]
            
            # Calculate dimensions in meters
            width_meters = abs(coords[2][0] - coords[0][0])  # longitude difference in degrees
            height_meters = abs(coords[2][1] - coords[0][1])  # latitude difference in degrees
            
            # Convert to meters (approximate conversion)
            meters_per_degree_lat = 111320  # at equator
            meters_per_degree_lon = meters_per_degree_lat * np.cos(np.mean([coords[0][1], coords[2][1]]) * np.pi / 180)
            
            width_meters = width_meters * meters_per_degree_lon
            height_meters = height_meters * meters_per_degree_lat
            
            self.logger.info(f"Region dimensions: {width_meters:.2f}m x {height_meters:.2f}m")
            
            # Calculate dimensions in pixels
            width_pixels = int(width_meters / scale)
            height_pixels = int(height_meters / scale)
            
            self.logger.info(f"Region dimensions in pixels: {width_pixels} x {height_pixels}")
            
            # Calculate maximum tile size based on Earth Engine's limit
            max_pixels_per_tile = 262144  # Earth Engine's limit
            max_tile_dimension = int(np.sqrt(max_pixels_per_tile))
            
            # Adjust chip size if needed to stay within limits
            if self.chip_size > max_tile_dimension:
                self.logger.warning(f"Adjusting chip size from {self.chip_size} to {max_tile_dimension} to stay within Earth Engine limits")
                self.chip_size = max_tile_dimension
            
            # Calculate number of tiles needed
            n_tiles_x = (width_pixels + self.chip_size - 1) // self.chip_size
            n_tiles_y = (height_pixels + self.chip_size - 1) // self.chip_size
            total_tiles = n_tiles_x * n_tiles_y
            
            self.logger.info(f"Processing {total_tiles} tiles ({n_tiles_x} x {n_tiles_y})")
            
            # Initialize lists for storing predictions
            all_geometries = []
            all_confidences = []
            processed_tiles = 0
            
            # Create bounding box as a GeoJSON feature for the region
            bounding_box = {
                'type': 'Feature',
                'geometry': {
                    'type': 'Polygon',
                    'coordinates': bounds['coordinates']
                },
                'properties': {}
            }
            
            # Prepare tile information for parallel processing
            tile_infos = []
            for y in range(n_tiles_y):
                for x in range(n_tiles_x):
                    # Calculate tile bounds in degrees
                    lon_min = coords[0][0] + x * (coords[2][0] - coords[0][0]) / n_tiles_x
                    lat_min = coords[0][1] + y * (coords[2][1] - coords[0][1]) / n_tiles_y
                    lon_max = coords[0][0] + (x + 1) * (coords[2][0] - coords[0][0]) / n_tiles_x
                    lat_max = coords[0][1] + (y + 1) * (coords[2][1] - coords[0][1]) / n_tiles_y
                    
                    # Create tile geometry
                    tile_geom = ee.Geometry.Rectangle([lon_min, lat_min, lon_max, lat_max])
                    
                    # Create tile info tuple with all necessary data
                    tile_info = (x, y, [[lon_min, lat_min], [lon_max, lat_min], [lon_max, lat_max], [lon_min, lat_max]], tile_geom)
                    tile_infos.append(tile_info)
            
            # Process tiles in parallel using batches
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                # Process in batches to avoid overwhelming Earth Engine
                for batch_start in range(0, len(tile_infos), batch_size):
                    batch_end = min(batch_start + batch_size, len(tile_infos))
                    batch = tile_infos[batch_start:batch_end]
                    
                    # Submit batch of tiles for processing
                    futures = [executor.submit(self._process_tile, tile_info, model, pred_threshold, tries) 
                               for tile_info in batch]
                    
                    # Collect results as they complete
                    for future in concurrent.futures.as_completed(futures):
                        geometries, confidences = future.result()
                        all_geometries.extend(geometries)
                        all_confidences.extend(confidences)
                        
                        processed_tiles += 1
                        
                        # Send incremental prediction updates to the frontend
                        if progress_callback and geometries:
                            # Create a GeoJSON feature collection for the new predictions
                            new_predictions = {
                                "type": "FeatureCollection",
                                "features": [
                                    {
                                        "type": "Feature",
                                        "geometry": {
                                            "type": "Polygon",
                                            "coordinates": [list(geom.exterior.coords)]
                                        },
                                        "properties": {
                                            "confidence": float(conf)
                                        }
                                    }
                                    for geom, conf in zip(geometries, confidences)
                                ]
                            }
                            
                            # Call the progress callback with the new predictions
                            progress_callback(
                                processed_tiles, 
                                total_tiles, 
                                incremental_predictions=new_predictions,
                                bounding_box=bounding_box
                            )
                        elif progress_callback:
                            # Just update progress if no new predictions
                            progress_callback(processed_tiles, total_tiles)
            
            # Create GeoDataFrame from predictions
            if all_geometries:
                # Create GeoDataFrame with the bounding box polygons
                gdf = gpd.GeoDataFrame({
                    'geometry': all_geometries,
                    'confidence': all_confidences
                }, crs="EPSG:4326")
                
                # Save predictions to file
                gdf.to_file(output_file, driver='GeoJSON')
                self.logger.info(f"Saved {len(gdf)} predictions as bounding boxes to {output_file}")
                return gdf
            else:
                self.logger.info("No predictions met the confidence threshold.")
                # Return empty GeoDataFrame with correct structure that will properly convert to GeoJSON
                empty_gdf = gpd.GeoDataFrame(columns=['geometry', 'confidence'], geometry='geometry', crs="EPSG:4326")
                return empty_gdf
                
        except Exception as e:
            self.logger.error(f"Error during prediction: {str(e)}")
            self.logger.error(f"Exception details: {traceback.format_exc()}")
            # Return empty GeoDataFrame in case of error to avoid breaking the UI
            empty_gdf = gpd.GeoDataFrame(columns=['geometry', 'confidence'], geometry='geometry', crs="EPSG:4326")
            return empty_gdf 
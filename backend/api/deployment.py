"""
Endpoints for model deployment
"""
from flask import request, jsonify
import os
import logging
import json
import traceback
from datetime import datetime
import geopandas as gpd

from config import PROJECTS_DIR
from services.deploy_service import ModelDeployer
from tensorflow import keras

logger = logging.getLogger(__name__)

def register_deployment_endpoints(app, socketio):
    """Register all deployment-related endpoints"""
    
    @app.route('/deploy_model', methods=['POST'])
    def deploy_model():
        """Deploy a trained model to make predictions on a region."""
        try:
            data = request.get_json()
            project_id = data.get('project_id')
            model_name = data.get('model_name')
            region = data.get('region')
            start_date = data.get('start_date')
            end_date = data.get('end_date')
            pred_threshold = data.get('pred_threshold', 0.5)
            clear_threshold = data.get('clear_threshold', 0.75)
            
            if not all([project_id, model_name, region, start_date, end_date]):
                return jsonify({
                    'success': False,
                    'message': 'Missing required parameters'
                })
            
            # Get the model file path
            model_path = os.path.join(PROJECTS_DIR, project_id, 'models', f'{model_name}.h5')
            if not os.path.exists(model_path):
                return jsonify({
                    'success': False,
                    'message': f'Model file not found: {model_path}'
                })
            
            # Load the model
            model = keras.models.load_model(model_path)
            
            # Create deployer instance
            deployer = ModelDeployer(project_id, chip_size=512)
            
            # Set up a custom log handler to capture and forward log messages
            class SocketIOLogHandler(logging.Handler):
                def emit(self, record):
                    try:
                        log_message = self.format(record)
                        if record.levelno >= logging.INFO:
                            socketio.emit('deployment_log', {
                                'project_id': project_id,
                                'message': log_message
                            })
                    except Exception:
                        self.handleError(record)
            
            # Add the custom handler to the deployer's logger
            socket_handler = SocketIOLogHandler()
            socket_handler.setLevel(logging.INFO)
            formatter = logging.Formatter('%(levelname)s:%(name)s:%(message)s')
            socket_handler.setFormatter(formatter)
            deployer.logger.addHandler(socket_handler)
            
            # Make predictions
            predictions = deployer.make_predictions(
                model=model,
                region=region,
                start_date=start_date,
                end_date=end_date,
                pred_threshold=pred_threshold,
                clear_threshold=clear_threshold,
                model_name=model_name,
                progress_callback=lambda current, total, incremental_predictions=None, bounding_box=None: socketio.emit('deployment_progress', {
                    'project_id': project_id,
                    'progress': current / total,
                    'status': f'Processing tile {current} of {total}',
                    'details': {
                        'current': current,
                        'total': total,
                        'region': 'Custom region',
                        'start_date': start_date,
                        'end_date': end_date
                    },
                    'incremental_predictions': incremental_predictions,
                    'bounding_box': bounding_box
                })
            )
            
            # Remove the custom handler
            deployer.logger.removeHandler(socket_handler)
            
            # Convert predictions to GeoJSON
            predictions_geojson = predictions.to_json()
            
            # Parse the GeoJSON and ensure it's valid before sending
            prediction_data = json.loads(predictions_geojson)
            
            # Validate GeoJSON structure
            if 'features' not in prediction_data:
                prediction_data = {"type": "FeatureCollection", "features": []}
            
            # Calculate bounding box from region
            region_ee = deployer.get_region_bounds(region)
            bounds = region_ee.bounds().getInfo()
            app.logger.info(f"Calculated bounds: {bounds}")  # Debug log
            
            # Create bounding box as a GeoJSON feature
            # Use the coordinates directly from the bounds
            bounding_box = {
                'type': 'Feature',
                'geometry': {
                    'type': 'Polygon',
                    'coordinates': bounds['coordinates']  # Use the coordinates directly
                },
                'properties': {
                    'start_date': start_date,
                    'end_date': end_date,
                    'model_name': model_name
                }
            }
            
            app.logger.info(f"Created bounding box: {bounding_box}")  # Debug log
            
            # Ensure bounding_box has a valid structure for the client to use
            if not bounding_box or 'geometry' not in bounding_box:
                # Default to a small area if bounding box is invalid
                app.logger.warning("Invalid bounding box - using default")
                
                # Create a bounding box from the region if possible
                try:
                    if isinstance(region, dict):
                        if 'type' in region and region['type'] == 'Polygon':
                            # Already a polygon, use it directly
                            bounding_box = {
                                "type": "Feature",
                                "geometry": region,
                                "properties": {
                                    'start_date': start_date,
                                    'end_date': end_date,
                                    'model_name': model_name
                                }
                            }
                        elif 'west' in region and 'north' in region and 'east' in region and 'south' in region:
                            # It's a bounds object with west/east/north/south
                            bounding_box = {
                                "type": "Feature",
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [
                                            [region["west"], region["north"]], 
                                            [region["east"], region["north"]], 
                                            [region["east"], region["south"]], 
                                            [region["west"], region["south"]], 
                                            [region["west"], region["north"]]
                                        ]
                                    ]
                                },
                                "properties": {
                                    'start_date': start_date,
                                    'end_date': end_date,
                                    'model_name': model_name
                                }
                            }
                        else:
                            # Can't determine format, use default
                            raise ValueError("Unknown region format")
                    else:
                        raise ValueError("Region is not a dictionary")
                except Exception as e:
                    app.logger.error(f"Error creating bounding box: {str(e)}")
                    # Use a small default area
                    bounding_box = {
                        "type": "Feature",
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1], [-0.1, -0.1]]]
                        },
                        "properties": {
                            'start_date': start_date,
                            'end_date': end_date,
                            'model_name': model_name
                        }
                    }
            
            # Emit completion event
            socketio.emit('deployment_complete', {
                'project_id': project_id,
                'num_predictions': len(predictions),
                'predictions': prediction_data,
                'bounding_box': bounding_box
            })
            
            return jsonify({
                'success': True,
                'predictions': prediction_data,
                'bounding_box': bounding_box
            })
            
        except Exception as e:
            logger.error(f"Error deploying model: {str(e)}")
            logger.error(traceback.format_exc())
            socketio.emit('deployment_error', {
                'project_id': project_id,
                'error': str(e)
            })
            return jsonify({
                'success': False,
                'message': str(e)
            })

    @app.route('/get_deployment_tiles', methods=['GET'])
    def get_deployment_tiles():
        try:
            # Get parameters from query string
            project_id = request.args.get('project_id', '')
            region = json.loads(request.args.get('region', '{}'))
            tile_size = 512
            
            if not project_id or not region:
                return jsonify({"success": False, "message": "Project ID and region are required"}), 400
            
            # Check if project exists
            project_dir = os.path.join(PROJECTS_DIR, project_id)
            if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
                return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
            
            # Initialize model deployer to calculate tiles
            from config import BUFFER_SIZES
            import numpy as np
            deployer = ModelDeployer(
                project_id=project_id,
                collection='S2',
                chip_size=tile_size
            )
            
            # Convert region to ee.Geometry
            region_ee = deployer.get_region_bounds(region)
            
            # Calculate tile dimensions
            bounds = region_ee.bounds()
            coords = bounds.getInfo()['coordinates'][0]
            
            # Calculate dimensions in meters
            width_meters = abs(coords[2][0] - coords[0][0])
            height_meters = abs(coords[2][1] - coords[0][1])
            
            # Convert to meters (approximate conversion)
            meters_per_degree_lat = 111320  # at equator
            meters_per_degree_lon = meters_per_degree_lat * np.cos(np.mean([coords[0][1], coords[2][1]]) * np.pi / 180)
            
            width_meters = width_meters * meters_per_degree_lon
            height_meters = height_meters * meters_per_degree_lat
            
            # Calculate dimensions in pixels
            scale = BUFFER_SIZES['S2']  # 10m resolution
            width_pixels = int(width_meters / scale)
            height_pixels = int(height_meters / scale)
            
            # Calculate tile size in degrees
            tile_size_meters = tile_size * scale
            tile_size_lat = tile_size_meters / meters_per_degree_lat
            tile_size_lon = tile_size_meters / meters_per_degree_lon
            
            # Calculate number of tiles
            n_tiles_x = (width_pixels + tile_size - 1) // tile_size
            n_tiles_y = (height_pixels + tile_size - 1) // tile_size
            
            # Generate tile geometries
            tiles = []
            for y in range(n_tiles_y):
                for x in range(n_tiles_x):
                    # Calculate tile bounds in degrees
                    lon_min = coords[0][0] + x * tile_size_lon
                    lat_min = coords[0][1] + y * tile_size_lat
                    lon_max = min(lon_min + tile_size_lon, coords[2][0])
                    lat_max = min(lat_min + tile_size_lat, coords[2][1])
                    
                    # Create tile polygon
                    tile_coords = [
                        [lon_min, lat_min],
                        [lon_max, lat_min],
                        [lon_max, lat_max],
                        [lon_min, lat_max],
                        [lon_min, lat_min]
                    ]
                    tiles.append({
                        'geometry': {
                            'type': 'Polygon',
                            'coordinates': [tile_coords]
                        },
                        'properties': {
                            'tile_id': f"{x}_{y}",
                            'x': x,
                            'y': y
                        }
                    })
            
            return jsonify({
                "success": True,
                "tiles": tiles,
                "dimensions": {
                    "width_pixels": width_pixels,
                    "height_pixels": height_pixels,
                    "n_tiles_x": n_tiles_x,
                    "n_tiles_y": n_tiles_y
                }
            })
            
        except Exception as e:
            logger.error(f"Error generating deployment tiles: {str(e)}")
            return jsonify({"success": False, "message": str(e)}), 500

    @app.route('/get_predictions', methods=['GET'])
    def get_predictions():
        """Get a list of previous predictions for a project."""
        try:
            project_id = request.args.get('project_id')
            if not project_id:
                return jsonify({
                    'success': False,
                    'message': 'Missing project_id parameter'
                })
            
            # Get the predictions directory
            predictions_dir = os.path.join(PROJECTS_DIR, project_id, 'predictions')
            if not os.path.exists(predictions_dir):
                return jsonify({
                    'success': True,
                    'predictions': []
                })
            
            # List all prediction files
            prediction_files = [f for f in os.listdir(predictions_dir) if f.endswith('.geojson')]
            predictions = []
            
            for filename in prediction_files:
                file_path = os.path.join(predictions_dir, filename)
                try:
                    # Read the GeoJSON file
                    with open(file_path, 'r') as f:
                        geojson = json.load(f)
                    
                    # Extract metadata from the file
                    properties = geojson.get('properties', {})
                    feature_count = len(geojson.get('features', []))
                    
                    # Get file creation time
                    created = datetime.fromtimestamp(os.path.getctime(file_path)).isoformat()
                    
                    # Extract timestamp from filename
                    timestamp = filename.replace('predictions_', '').replace('.geojson', '')
                    
                    predictions.append({
                        'id': timestamp,
                        'filename': filename,
                        'created': created,
                        'feature_count': feature_count,
                        'model_name': properties.get('model_name', 'Unknown'),
                        'start_date': properties.get('start_date', ''),
                        'end_date': properties.get('end_date', '')
                    })
                except Exception as e:
                    app.logger.error(f"Error reading prediction file {filename}: {str(e)}")
            
            # Sort predictions by creation time (newest first)
            predictions.sort(key=lambda x: x['created'], reverse=True)
            
            return jsonify({
                'success': True,
                'predictions': predictions
            })
            
        except Exception as e:
            app.logger.error(f"Error getting predictions: {str(e)}")
            return jsonify({
                'success': False,
                'message': f"Error getting predictions: {str(e)}"
            })
    
    @app.route('/get_prediction', methods=['GET'])
    def get_prediction():
        """Get a specific prediction by ID."""
        try:
            project_id = request.args.get('project_id')
            prediction_id = request.args.get('prediction_id')
            
            if not project_id or not prediction_id:
                return jsonify({
                    'success': False,
                    'message': 'Missing required parameters'
                })
            
            # Get the prediction file path
            predictions_dir = os.path.join(PROJECTS_DIR, project_id, 'predictions')
            file_path = os.path.join(predictions_dir, f'predictions_{prediction_id}.geojson')
            
            if not os.path.exists(file_path):
                return jsonify({
                    'success': False,
                    'message': f'Prediction file not found: {file_path}'
                })
            
            # Read the GeoJSON file
            with open(file_path, 'r') as f:
                geojson = json.load(f)
            
            # Get the properties which should contain the original bounding box information
            properties = geojson.get('properties', {})
            
            # Create a bounding box from the properties
            bounds = None
            
            # If the file has a 'region_bounds' property, use that for the bounding box
            if 'region_bounds' in properties:
                bounds = {
                    'type': 'Feature',
                    'geometry': {
                        'type': 'Polygon',
                        'coordinates': properties['region_bounds']['coordinates']
                    },
                    'properties': properties
                }
            # Otherwise, calculate bounds from features as a fallback
            elif geojson.get('features'):
                try:
                    # Create a GeoDataFrame from the features
                    gdf = gpd.GeoDataFrame.from_features(geojson)
                    if not gdf.empty:
                        # Get the total bounds
                        minx, miny, maxx, maxy = gdf.total_bounds
                        bounds = {
                            'type': 'Feature',
                            'geometry': {
                                'type': 'Polygon',
                                'coordinates': [
                                    [
                                        [minx, miny],
                                        [maxx, miny],
                                        [maxx, maxy],
                                        [minx, maxy],
                                        [minx, miny]
                                    ]
                                ]
                            },
                            'properties': properties
                        }
                except Exception as e:
                    app.logger.error(f"Error calculating bounds: {str(e)}")
            
            return jsonify({
                'success': True,
                'prediction': geojson,
                'bounding_box': bounds
            })
            
        except Exception as e:
            app.logger.error(f"Error getting prediction: {str(e)}")
            return jsonify({
                'success': False,
                'message': f"Error getting prediction: {str(e)}"
            })

    # Return routes for documentation purposes
    documented_routes = {
        "deploy_model": "POST /deploy_model - Deploy a trained model to make predictions",
        "get_deployment_tiles": "GET /get_deployment_tiles - Get tile geometries for deployment",
        "get_predictions": "GET /get_predictions - Get a list of previous predictions for a project",
        "get_prediction": "GET /get_prediction - Get a specific prediction by ID"
    }
    
    return documented_routes
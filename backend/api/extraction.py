"""
Endpoints for satellite data extraction
"""
from flask import request, jsonify
import os
import datetime
import json
import logging
import base64
import io
from PIL import Image
import numpy as np
import xarray as xr
import matplotlib.pyplot as plt
import matplotlib.colors as colors
import traceback

from config import PROJECTS_DIR, BUFFER_SIZES
from services.gee_service import GEEDataExtractor

logger = logging.getLogger(__name__)

# Helper class for NumPy serialization
class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(NumpyEncoder, self).default(obj)

def register_extraction_endpoints(app, socketio):
    """Register all extraction-related endpoints"""
    
    @app.route('/export_points', methods=['POST'])
    def export_points():
        try:
            # Get the GeoJSON data and project ID from the request
            data = request.json
            geojson = data.get('geojson', {})
            project_id = data.get('project_id', '')
            
            logger.info(f"Exporting points for project: {project_id}")
            
            if not project_id:
                return jsonify({"success": False, "message": "Project ID is required"}), 400
                
            # Check if project exists
            project_dir = os.path.join(PROJECTS_DIR, project_id)
            if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
                return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
            
            if not geojson or 'features' not in geojson or not geojson['features']:
                return jsonify({"success": False, "message": "No valid GeoJSON features provided"})
            
            # Log the received features
            features = geojson['features']
            logger.info(f"Received {len(features)} features")
            
            # Set the output file to a consistent name instead of timestamped names
            master_points_file = os.path.join(project_dir, "points.geojson")
            
            # Extract new point IDs
            new_ids = set()
            for feature in features:
                if 'properties' in feature and 'id' in feature['properties']:
                    new_ids.add(str(feature['properties']['id']))
            
            # Check if we need to clean up extracted data
            if os.path.exists(master_points_file):
                try:
                    # Read the old GeoJSON file directly
                    with open(master_points_file, 'r') as f:
                        old_geojson = json.load(f)
                    
                    old_features = old_geojson.get('features', [])
                    logger.info(f"Old features: {len(old_features)}, New features: {len(features)}")
                    
                    # Extract old point IDs
                    old_ids = set()
                    for feature in old_features:
                        if 'properties' in feature and 'id' in feature['properties']:
                            old_ids.add(str(feature['properties']['id']))
                    
                    # Find removed points
                    if len(old_features) > len(features):
                        removed_ids = old_ids - new_ids
                        
                        if removed_ids:
                            logger.info(f"Found {len(removed_ids)} removed points: {removed_ids}")
                            # Clean up extracted data for removed points
                            cleanup_extracted_data(project_id, removed_ids)
                        else:
                            logger.info("No points were removed (IDs don't match)")
                    else:
                        logger.info("No points were removed (count check)")
                except Exception as e:
                    logger.error(f"Error checking for removed points: {str(e)}")
                    logger.error(f"Traceback: {traceback.format_exc()}")
            
            # Convert to GeoDataFrame 
            import geopandas as gpd
            new_features = geojson['features']
            new_gdf = gpd.GeoDataFrame.from_features(new_features)
            
            # Ensure we have the right CRS (WGS84)
            new_gdf.crs = "EPSG:4326"
            
            # Save the new points directly (replacing any existing file)
            new_gdf.to_file(master_points_file, driver="GeoJSON")
            gdf = new_gdf
            
            point_counts = {
                'positive': len(gdf[gdf['class'] == 'positive']),
                'negative': len(gdf[gdf['class'] == 'negative']),
                'total': len(gdf)
            }
            
            logger.info(f"Updated master points file with {len(new_gdf)} points, total: {point_counts['total']}")
            logger.info(f"  - Positive: {point_counts['positive']}")
            logger.info(f"  - Negative: {point_counts['negative']}")
            
            # Return success response
            return jsonify({
                "success": True,
                "message": f"Saved {point_counts['total']} points to master file",
                "filename": "points.geojson",
                "counts": point_counts
            })
            
        except Exception as e:
            logger.error(f"Error exporting points: {str(e)}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            return jsonify({"success": False, "message": str(e)}), 500

    @app.route('/load_points', methods=['GET'])
    def load_points():
        try:
            # Get the project id and optional filename from the query parameters
            project_id = request.args.get('project_id', '')
            filename = request.args.get('filename', 'points.geojson')  # Default to master points file
            
            if not project_id:
                return jsonify({"success": False, "message": "Project ID is required"}), 400
            
            # Check if project exists
            project_dir = os.path.join(PROJECTS_DIR, project_id)
            if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
                return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
            
            # Check if file exists
            filepath = os.path.join(project_dir, filename)
            if not os.path.exists(filepath):
                # If the master file doesn't exist, return an empty GeoJSON
                if filename == 'points.geojson':
                    return jsonify({
                        "success": True,
                        "geojson": {
                            "type": "FeatureCollection",
                            "features": []
                        }
                    })
                else:
                    return jsonify({"success": False, "message": f"File '{filename}' not found in project '{project_id}'"}), 404
            
            # Read the GeoJSON file
            import geopandas as gpd
            gdf = gpd.read_file(filepath)
            
            # Convert to GeoJSON
            geojson = json.loads(gdf.to_json())
            
            # Return the GeoJSON data
            return jsonify({
                "success": True,
                "geojson": geojson
            })
            
        except Exception as e:
            return jsonify({"success": False, "message": str(e)}), 500

    @app.route('/extract_data', methods=['POST'])
    def extract_data():
        project_id = None
        try:
            # Get parameters from the request
            data = request.json
            project_id = data.get('project_id', '')
            collection = data.get('collection', 'S2')
            start_date = data.get('start_date', '')
            end_date = data.get('end_date', '')
            chip_size = data.get('chip_size', 64)
            clear_threshold = data.get('clear_threshold', 0.75)
            num_workers = data.get('num_workers', None)  # Get number of workers from request
            
            # If num_workers is not specified, use a conservative default
            if num_workers is None:
                # Use a smaller number of workers by default to avoid overwhelming the Earth Engine API
                import multiprocessing
                num_workers = min(4, max(1, multiprocessing.cpu_count() // 2))
            
            # Validate inputs
            if not project_id:
                return jsonify({"success": False, "message": "Project ID is required"}), 400
            
            if not start_date or not end_date:
                return jsonify({"success": False, "message": "Start date and end date are required"}), 400
            
            # Check if project exists
            project_dir = os.path.join(PROJECTS_DIR, project_id)
            if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
                return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
            
            # Check if points exist
            points_file = os.path.join(project_dir, 'points.json')
            geojson_files = [f for f in os.listdir(project_dir) if f.endswith('.geojson')]
            
            if not os.path.exists(points_file) and not geojson_files:
                return jsonify({"success": False, "message": "No points found in project. Please add points first."}), 400
            
            # Initialize GEE data extractor
            try:
                extractor = GEEDataExtractor(
                    project_id=project_id,
                    collection=collection,
                    chip_size=chip_size
                )
            except Exception as e:
                logger.error(f"Error initializing GEE extractor: {str(e)}")
                return jsonify({"success": False, "message": f"Error initializing Earth Engine: {str(e)}"}), 500
            
            # Create a progress callback function
            def progress_callback(current, total):
                progress = (current / total) * 100
                socketio.emit('extraction_progress', {
                    'project_id': project_id,
                    'progress': progress,
                    'current': current,
                    'total': total
                })
            
            # Extract data with progress updates
            try:
                output_file, metadata_file = extractor.extract_chips_for_project(
                    start_date=start_date,
                    end_date=end_date,
                    clear_threshold=clear_threshold,
                    progress_callback=progress_callback,
                    num_workers=num_workers  # Pass number of workers parameter
                )
            except Exception as e:
                logger.error(f"Error during extraction process: {str(e)}")
                error_message = f"Error during extraction: {str(e)}"
                socketio.emit('extraction_error', {
                    'project_id': project_id,
                    'error': error_message,
                    'error_type': type(e).__name__
                })
                return jsonify({"success": False, "message": error_message}), 500
            
            # Read metadata
            try:
                with open(metadata_file, 'r') as f:
                    metadata = json.load(f)
            except Exception as e:
                logger.error(f"Error reading metadata file: {str(e)}")
                return jsonify({"success": False, "message": f"Error reading metadata: {str(e)}"}), 500
            
            # Send completion message
            socketio.emit('extraction_complete', {
                'project_id': project_id,
                'output_file': os.path.basename(output_file),
                'metadata': metadata
            })
            
            return jsonify({
                "success": True,
                "message": f"Successfully extracted {metadata['num_chips']} chips",
                "output_file": os.path.basename(output_file),
                "metadata": metadata
            })
            
        except Exception as e:
            error_message = f"Error extracting data: {str(e)}"
            logger.error(error_message)
            
            # Send more detailed error information
            if project_id:
                socketio.emit('extraction_error', {
                    'project_id': project_id,
                    'error': error_message,
                    'error_type': type(e).__name__
                })
            
            return jsonify({
                "success": False, 
                "message": error_message,
                "error_type": type(e).__name__
            }), 500

    @app.route('/list_extracted_data', methods=['GET'])
    def list_extracted_data():
        try:
            # Get the project id from the query parameters
            project_id = request.args.get('project_id', '')
            
            logger.info(f"list_extracted_data called for project: {project_id}")
            
            if not project_id:
                return jsonify({"success": False, "message": "Project ID is required"}), 400
            
            # Check if project exists
            project_dir = os.path.join(PROJECTS_DIR, project_id)
            if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
                return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
            
            # Check if extracted_data directory exists
            extracted_dir = os.path.join(project_dir, "extracted_data")
            if not os.path.exists(extracted_dir):
                logger.info(f"No extracted_data directory found at {extracted_dir}")
                return jsonify({"success": True, "extractions": []})
            
            # Get all netCDF files
            nc_files = [f for f in os.listdir(extracted_dir) if f.endswith('.nc')]
            logger.info(f"Found {len(nc_files)} netCDF files in {extracted_dir}:")
            for file in nc_files:
                logger.info(f"  - {file}")
            
            if len(nc_files) == 0:
                return jsonify({"success": True, "extractions": []})
            
            # Look for project data files
            extractions = []
            
            # Look for any file with "extracted_data.nc" in the name - these are project data files
            project_data_files = [f for f in nc_files if "extracted_data.nc" in f]
            logger.info(f"Found {len(project_data_files)} project data files: {project_data_files}")
            
            if project_data_files:
                # Process project data files first
                for nc_file in project_data_files:
                    # Find corresponding metadata file
                    base_name = nc_file.rsplit('.', 1)[0]
                    metadata_file = f"{base_name}_metadata.json"
                    metadata_path = os.path.join(extracted_dir, metadata_file)
                    
                    logger.info(f"Looking for metadata file: {metadata_path}")
                    
                    file_path = os.path.join(extracted_dir, nc_file)
                    file_size = os.path.getsize(file_path) / (1024 * 1024)  # Convert to MB
                    
                    if os.path.exists(metadata_path):
                        with open(metadata_path, 'r') as f:
                            metadata = json.load(f)
                        
                        # For project data files, use the last_updated field
                        last_updated = metadata.get('last_updated', '')
                        collection = metadata.get('collection', '')
                        start_date = metadata.get('start_date', '')
                        end_date = metadata.get('end_date', '')
                        num_chips = metadata.get('num_chips', 0)
                    else:
                        # Create default metadata if file exists but metadata doesn't
                        last_updated = datetime.datetime.fromtimestamp(os.path.getmtime(file_path)).strftime('%Y-%m-%d %H:%M:%S')
                        # Try to extract collection from filename (e.g., S2_64px_extracted_data.nc -> S2)
                        collection = nc_file.split('_')[0] if '_' in nc_file else ''
                        start_date = ''
                        end_date = ''
                        num_chips = 0
                    
                    extraction_data = {
                        'filename': nc_file,
                        'created': datetime.datetime.fromtimestamp(os.path.getctime(file_path)).strftime('%Y-%m-%d %H:%M:%S'),
                        'last_updated': last_updated,
                        'collection': collection,
                        'start_date': start_date,
                        'end_date': end_date,
                        'num_chips': num_chips,
                        'is_project_data': True,
                        'file_size_mb': round(file_size, 2)
                    }
                    extractions.append(extraction_data)
                    logger.info(f"Added project data file to extractions: {nc_file}")
                
                # If we found project data files, just return those and skip legacy files
                if extractions:
                    # Sort by creation time, most recent first
                    extractions.sort(key=lambda x: x.get('last_updated', x.get('created', '')), reverse=True)
                    
                    return jsonify({
                        "success": True, 
                        "extractions": extractions
                    })
            
            # If no project data files found, process legacy files
            legacy_files = [f for f in nc_files if "extracted_data.nc" not in f]
            logger.info(f"Processing {len(legacy_files)} legacy files")
            
            for nc_file in legacy_files:
                # Find corresponding metadata file
                base_name = nc_file.rsplit('.', 1)[0]
                metadata_file = f"{base_name}_metadata.json"
                metadata_path = os.path.join(extracted_dir, metadata_file)
                
                if os.path.exists(metadata_path):
                    with open(metadata_path, 'r') as f:
                        metadata = json.load(f)
                        
                    file_path = os.path.join(extracted_dir, nc_file)
                    file_size = os.path.getsize(file_path) / (1024 * 1024)  # Convert to MB
                    
                    extraction_data = {
                        'filename': nc_file,
                        'created': datetime.datetime.fromtimestamp(os.path.getctime(file_path)).strftime('%Y-%m-%d %H:%M:%S'),
                        'extraction_time': metadata.get('extraction_time', ''),
                        'collection': metadata.get('collection', ''),
                        'start_date': metadata.get('start_date', ''),
                        'end_date': metadata.get('end_date', ''),
                        'num_chips': metadata.get('num_chips', 0),
                        'is_project_data': False,
                        'file_size_mb': round(file_size, 2)
                    }
                    extractions.append(extraction_data)
            
            logger.info(f"Returning {len(extractions)} extractions:")
            for ext in extractions:
                logger.info(f"  - {ext['filename']} (is_project_data: {ext['is_project_data']})")
            
            # Sort by creation time, most recent first
            extractions.sort(key=lambda x: x.get('last_updated', x.get('extraction_time', x.get('created', ''))), reverse=True)
            
            return jsonify({
                "success": True, 
                "extractions": extractions
            })
            
        except Exception as e:
            logger.error(f"Error in list_extracted_data: {str(e)}")
            return jsonify({"success": False, "message": str(e)}), 500

    @app.route('/get_patch_visualization', methods=['GET'])
    def get_patch_visualization():
        try:
            # Get query parameters
            project_id = request.args.get('project_id', '')
            extraction_file = request.args.get('file', '')
            visualization_type = request.args.get('vis_type', 'true_color')
            check_only = request.args.get('check_only', 'false').lower() == 'true'
            
            logger.info(f"get_patch_visualization called: project={project_id}, file={extraction_file}, type={visualization_type}, check_only={check_only}")
            
            if not project_id:
                return jsonify({"success": False, "message": "Project ID is required"}), 400
            
            # Check if project exists
            project_dir = os.path.join(PROJECTS_DIR, project_id)
            if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
                return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
            
            # Check if extracted_data directory exists
            extracted_dir = os.path.join(project_dir, "extracted_data")
            if not os.path.exists(extracted_dir):
                return jsonify({"success": False, "message": "No extracted data found"}), 404
            
            # If no specific file is provided, look for project data file
            if not extraction_file:
                # Get all .nc files
                nc_files = [f for f in os.listdir(extracted_dir) if f.endswith('.nc')]
                
                # Look for any file with "extracted_data.nc" in the name - these are project data files
                project_data_files = [f for f in nc_files if "extracted_data.nc" in f]
                
                if project_data_files:
                    # Sort by modification time (most recent first)
                    project_data_files.sort(key=lambda f: os.path.getmtime(os.path.join(extracted_dir, f)), reverse=True)
                    extraction_file = project_data_files[0]
                else:
                    # No project data file found, try to get the most recent file
                    if nc_files:
                        # Sort by modification time (most recent first)
                        nc_files.sort(key=lambda f: os.path.getmtime(os.path.join(extracted_dir, f)), reverse=True)
                        extraction_file = nc_files[0]
                    else:
                        return jsonify({"success": False, "message": "No extracted data files found"}), 404
            
            # Check if the extraction file exists
            file_path = os.path.join(extracted_dir, extraction_file)
            if not os.path.exists(file_path):
                return jsonify({"success": False, "message": f"Extraction file '{extraction_file}' not found"}), 404
                
            # If we only want to check if the file exists, return now
            if check_only:
                return jsonify({
                    "success": True,
                    "file_exists": True,
                    "filename": extraction_file,
                    "project_id": project_id
                })
            
            # Open the dataset
            ds = xr.open_dataset(file_path)
            
            # Get the visualization data
            collection = ds.attrs.get('collection', 'S2')
            
            # Prepare patches data
            patch_data = []
            
            # Get the chips, coordinates, and labels
            chips = ds.chips.values
            longitudes = ds.longitude.values
            latitudes = ds.latitude.values
            labels = ds.label.values
            bands = ds.band.values.tolist()
            
            # Create visualization data for each patch
            for i in range(len(longitudes)):
                # Get the current chip and its coordinates
                chip = chips[i]
                lon = float(longitudes[i])  # Convert to Python float
                lat = float(latitudes[i])   # Convert to Python float
                label = str(labels[i])      # Convert to Python string
                
                # Create visualization based on the collection and requested type
                img_data = None
                
                if collection == 'S2':
                    if visualization_type == 'true_color':
                        # True color: RGB (B4, B3, B2)
                        red_idx = bands.index('B4') if 'B4' in bands else None
                        green_idx = bands.index('B3') if 'B3' in bands else None
                        blue_idx = bands.index('B2') if 'B2' in bands else None
                        
                        if red_idx is not None and green_idx is not None and blue_idx is not None:
                            rgb = np.stack(
                                [
                                    np.clip(chip[:, :, red_idx] / 3000, 0, 1),
                                    np.clip(chip[:, :, green_idx] / 3000, 0, 1),
                                    np.clip(chip[:, :, blue_idx] / 3000, 0, 1)
                                ], 
                                axis=-1
                            )
                            img_data = rgb
                    
                    elif visualization_type == 'false_color':
                        # False color: NIR, Red, Green (B8, B4, B3)
                        nir_idx = bands.index('B8') if 'B8' in bands else bands.index('B8A') if 'B8A' in bands else None
                        red_idx = bands.index('B4') if 'B4' in bands else None
                        green_idx = bands.index('B3') if 'B3' in bands else None
                        
                        if nir_idx is not None and red_idx is not None and green_idx is not None:
                            rgb = np.stack(
                                [
                                    np.clip(chip[:, :, nir_idx] / 5000, 0, 1),
                                    np.clip(chip[:, :, red_idx] / 3000, 0, 1),
                                    np.clip(chip[:, :, green_idx] / 3000, 0, 1)
                                ], 
                                axis=-1
                            )
                            img_data = rgb
                    
                    elif visualization_type == 'ndvi':
                        # NDVI visualization
                        nir_idx = bands.index('B8') if 'B8' in bands else bands.index('B8A') if 'B8A' in bands else None
                        red_idx = bands.index('B4') if 'B4' in bands else None
                        
                        if nir_idx is not None and red_idx is not None:
                            nir = chip[:, :, nir_idx].astype(float)
                            red = chip[:, :, red_idx].astype(float)
                            
                            # Avoid division by zero
                            denominator = nir + red
                            ndvi = np.zeros_like(nir)
                            valid_idx = denominator > 0
                            ndvi[valid_idx] = (nir[valid_idx] - red[valid_idx]) / denominator[valid_idx]
                            
                            # Apply colormap directly without using matplotlib figure
                            # Define the NDVI colormap (similar to RdYlGn)
                            # Colors from red (-1) to green (1)
                            colors_rgba = np.array([
                                [0.84, 0.19, 0.15, 1.0],  # dark red
                                [0.99, 0.55, 0.35, 1.0],  # light red
                                [0.99, 0.88, 0.55, 1.0],  # yellow
                                [0.85, 0.94, 0.55, 1.0],  # light green
                                [0.57, 0.81, 0.38, 1.0],  # medium green
                                [0.10, 0.60, 0.31, 1.0]   # dark green
                            ])
                            
                            # Normalize NDVI values from [-1, 1] to [0, 1] for colormap indexing
                            ndvi_norm = (ndvi + 1) / 2
                            ndvi_norm = np.clip(ndvi_norm, 0, 1)
                            
                            # Create RGB image by mapping NDVI values to colors
                            # Scale the normalized values to the colormap indices
                            idx = np.clip((ndvi_norm * (len(colors_rgba) - 1)), 0, len(colors_rgba) - 1.001)
                            
                            # Get the indices for interpolation
                            idx_low = np.floor(idx).astype(int)
                            idx_high = np.ceil(idx).astype(int)
                            frac = idx - idx_low
                            
                            # Create empty RGB image
                            h, w = ndvi.shape
                            rgb = np.zeros((h, w, 3))
                            
                            # Apply linear interpolation between colors
                            for i in range(3):  # RGB channels
                                low_val = colors_rgba[idx_low, i]
                                high_val = colors_rgba[idx_high, i]
                                
                                # Reshape frac for broadcasting
                                frac_reshaped = frac.reshape(h, w)
                                
                                # Interpolate
                                rgb[:, :, i] = low_val * (1 - frac_reshaped) + high_val * frac_reshaped
                            
                            img_data = rgb
                
                elif collection == 'S1':
                    # For Sentinel-1, create a simple visualization using VV and VH bands
                    vv_idx = bands.index('VV') if 'VV' in bands else None
                    vh_idx = bands.index('VH') if 'VH' in bands else None
                    
                    if vv_idx is not None and vh_idx is not None:
                        # Simple RGB composite using VV for red and green, VH for blue
                        vv = np.clip(chip[:, :, vv_idx] / 0.3, 0, 1)  # Typical range for VV
                        vh = np.clip(chip[:, :, vh_idx] / 0.1, 0, 1)  # Typical range for VH
                        
                        rgb = np.stack([vv, vv, vh], axis=-1)
                        img_data = rgb
                
                # If we have image data, encode it as base64
                if img_data is not None:
                    # Convert to 8-bit image
                    img_8bit = (img_data * 255).astype(np.uint8)
                    img = Image.fromarray(img_8bit)
                    
                    # Save to buffer and encode as base64
                    buffer = io.BytesIO()
                    img.save(buffer, format='PNG')
                    img_str = base64.b64encode(buffer.getvalue()).decode('utf-8')
                    
                    # Create patch info with all native Python types
                    patch_info = {
                        'longitude': float(lon),
                        'latitude': float(lat),
                        'label': str(label),
                        'image': img_str,
                        'chip_size': int(ds.attrs.get('chip_size', 64))
                    }
                    
                    patch_data.append(patch_info)
            
            # Close the dataset
            ds.close()
            
            # Use the custom JSON encoder to handle NumPy types
            return json.dumps({
                "success": True,
                "collection": collection,
                "visualization_type": visualization_type,
                "patches": patch_data
            }, cls=NumpyEncoder), 200, {'Content-Type': 'application/json'}
            
        except Exception as e:
            logger.error(f"Error processing patch visualization: {str(e)}")
            return jsonify({"success": False, "message": str(e)}), 500
    
    @app.route('/get_map_imagery', methods=['GET'])
    def get_map_imagery():
        try:
            # Get query parameters
            west = float(request.args.get('west', ''))
            south = float(request.args.get('south', ''))
            east = float(request.args.get('east', ''))
            north = float(request.args.get('north', ''))
            
            start_date = request.args.get('start_date', '')
            end_date = request.args.get('end_date', '')
            collection = request.args.get('collection', 'S2')
            clear_threshold = float(request.args.get('clear_threshold', '0.75'))
            
            # Validate parameters
            if not all([west, south, east, north]):
                return jsonify({"success": False, "message": "Map bounds (west, south, east, north) are required"}), 400
                
            if not start_date or not end_date:
                return jsonify({"success": False, "message": "Start date and end date are required"}), 400
            
            # Create a temporary project ID for the extractor
            temp_project_id = f"temp_map_imagery_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"
            
            # Initialize the extractor - Earth Engine will be initialized in the constructor
            extractor = GEEDataExtractor(
                project_id=temp_project_id,
                collection=collection,
                chip_size=1024  # Larger size for map tiles
            )
            
            # Create the image collection with cloud masking
            composite = extractor.create_image_collection(start_date, end_date, clear_threshold)
            
            # For Sentinel-2, get RGB bands for true color visualization
            if collection == 'S2':
                # True color: RGB (B4, B3, B2)
                visualization_params = {
                    'bands': ['B4', 'B3', 'B2'],
                    'min': 0,
                    'max': 3000,
                    'gamma': 1.4
                }
            elif collection == 'S1':
                # For Sentinel-1, use VV and VH bands
                visualization_params = {
                    'bands': ['VV', 'VV', 'VH'],
                    'min': [-20, -20, -25],
                    'max': [0, 0, -5]
                }
            
            # Generate the map URL using Earth Engine
            map_id = composite.getMapId(visualization_params)
            tile_url_template = map_id['tile_fetcher'].url_format
            
            # Print the tile URL for debugging
            logger.info(f"Tile URL template: {tile_url_template}")
            
            # Convert high-volume endpoint to standard endpoint
            if "earthengine-highvolume.googleapis.com" in tile_url_template:
                tile_url_template = tile_url_template.replace(
                    "earthengine-highvolume.googleapis.com", 
                    "earthengine.googleapis.com"
                )
                logger.info(f"Modified tile URL to use standard endpoint: {tile_url_template}")
            
            return jsonify({
                "success": True,
                "tile_url": tile_url_template,
                "bounds": {
                    "west": west,
                    "south": south,
                    "east": east,
                    "north": north
                },
                "date_range": {
                    "start": start_date,
                    "end": end_date
                },
                "collection": collection
            })
            
        except Exception as e:
            logger.error(f"Error retrieving map imagery: {str(e)}")
            return jsonify({"success": False, "message": str(e)}), 500

    # Helper function for cleanup_extracted_data
    def cleanup_extracted_data(project_id, removed_point_ids):
        """
        Clean up extracted data for removed points
        
        Args:
            project_id (str): Project ID
            removed_point_ids (set): Set of point IDs that were removed
        """
        try:
            # Get the project directory
            project_dir = os.path.join(PROJECTS_DIR, project_id)
            extracted_dir = os.path.join(project_dir, "extracted_data")
            
            logger.info(f"Cleaning up extracted data for project {project_id}")
            logger.info(f"Removed point IDs: {removed_point_ids}")
            
            # Convert all removed_point_ids to strings to ensure consistent comparison
            removed_point_ids = {str(pid) for pid in removed_point_ids}
            
            if not os.path.exists(extracted_dir):
                logger.info(f"No extracted_data directory found at {extracted_dir}")
                return
            
            # Get all netCDF files
            nc_files = [f for f in os.listdir(extracted_dir) if f.endswith('.nc')]
            logger.info(f"Found {len(nc_files)} netCDF files to check")
            
            for nc_file in nc_files:
                file_path = os.path.join(extracted_dir, nc_file)
                logger.info(f"Processing file: {nc_file}")
                
                try:
                    # Open the netCDF file
                    with xr.open_dataset(file_path) as ds:
                        # Check if the dataset has point IDs
                        if 'point_id' in ds:
                            # Get point IDs as strings
                            point_ids = [str(pid) for pid in ds.point_id.values]
                            
                            # Find indices of points to keep
                            keep_indices = [i for i, pid in enumerate(point_ids) if pid not in removed_point_ids]
                            removed_indices = [i for i, pid in enumerate(point_ids) if pid in removed_point_ids]
                            
                            logger.info(f"Points to keep: {len(keep_indices)}, Points to remove: {len(removed_indices)}")
                            if removed_indices:
                                logger.info(f"Removing point indices: {removed_indices}")
                                logger.info(f"Removing point IDs: {[point_ids[i] for i in removed_indices]}")
                            
                            if len(keep_indices) < len(point_ids):
                                # Create a new dataset without the removed points
                                logger.info(f"Creating new dataset with {len(keep_indices)} points")
                                new_ds = ds.isel(point=keep_indices)
                                
                                # Ensure label has a consistent data type
                                if 'label' in new_ds:
                                    # Convert label to string if it's an object type
                                    if new_ds.label.dtype == 'O':
                                        logger.info(f"Converting label from {new_ds.label.dtype} to string type")
                                        new_ds['label'] = new_ds.label.astype(str)
                                
                                # Check for other object dtypes that might cause issues
                                for var_name, var in new_ds.variables.items():
                                    if var.dtype == 'O':
                                        logger.info(f"Warning: Variable '{var_name}' has object dtype which may cause serialization issues")
                                        try:
                                            # Try to convert to string
                                            new_ds[var_name] = var.astype(str)
                                            logger.info(f"Converted '{var_name}' to string type")
                                        except Exception as e:
                                            logger.info(f"Could not convert '{var_name}' to string: {e}")
                                
                                # Save to a temporary file
                                temp_file = file_path + '.temp'
                                try:
                                    new_ds.to_netcdf(temp_file)
                                    
                                    # Close the dataset
                                    new_ds.close()
                                    
                                    # Replace the original file
                                    os.replace(temp_file, file_path)
                                    
                                    logger.info(f"Successfully removed data for {len(point_ids) - len(keep_indices)} points from {nc_file}")
                                except Exception as e:
                                    logger.error(f"Error saving modified dataset: {e}")
                                    logger.error(f"Dataset variables: {list(new_ds.variables.keys())}")
                                    logger.error(f"Dataset dtypes: {[(name, var.dtype) for name, var in new_ds.variables.items()]}")
                                    new_ds.close()
                                    # Clean up temp file if it exists
                                    if os.path.exists(temp_file):
                                        try:
                                            os.remove(temp_file)
                                        except:
                                            pass
                                    raise
                            else:
                                logger.info(f"No points to remove from {nc_file}")
                except Exception as e:
                    logger.error(f"Error processing {nc_file}: {str(e)}")
                    logger.error(f"Traceback: {traceback.format_exc()}")
        
        except Exception as e:
            logger.error(f"Error cleaning up extracted data: {str(e)}")
            logger.error(f"Traceback: {traceback.format_exc()}")

    @app.route('/check_file_exists', methods=['GET'])
    def check_file_exists():
        try:
            # Get parameters
            project_id = request.args.get('project_id', '')
            filename = request.args.get('filename', '')
            
            if not project_id or not filename:
                return jsonify({"success": False, "message": "Project ID and filename are required"}), 400
            
            # Check if project exists
            project_dir = os.path.join(PROJECTS_DIR, project_id)
            if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
                return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
            
            # Check if extracted_data directory exists
            extracted_dir = os.path.join(project_dir, "extracted_data")
            if not os.path.exists(extracted_dir):
                return jsonify({"success": True, "file_exists": False})
            
            # Check if file exists
            file_path = os.path.join(extracted_dir, filename)
            file_exists = os.path.exists(file_path)
            
            logger.info(f"Checking if {file_path} exists: {file_exists}")
            
            return jsonify({
                "success": True,
                "file_exists": file_exists,
                "project_id": project_id,
                "filename": filename
            })
        
        except Exception as e:
            logger.error(f"Error in check_file_exists: {str(e)}")
            return jsonify({"success": False, "message": str(e)}), 500

    # Return routes for documentation purposes
    documented_routes = {
        "export_points": "POST /export_points - Export points for a project",
        "load_points": "GET /load_points - Load points for a project",
        "extract_data": "POST /extract_data - Extract satellite data for points",
        "list_extracted_data": "GET /list_extracted_data - List extracted data for a project",
        "get_patch_visualization": "GET /get_patch_visualization - Get visualization for extracted data",
        "get_map_imagery": "GET /get_map_imagery - Get map imagery for a region",
        "check_file_exists": "GET /check_file_exists - Check if a file exists"
    }
    
    return documented_routes
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO
import json
import os
import datetime
import geopandas as gpd
import shutil
import logging
import base64
import io
from PIL import Image
import numpy as np
import xarray as xr
import matplotlib.pyplot as plt
import matplotlib.colors as colors
from tensorflow import keras
import multiprocessing
import pandas as pd
import traceback


# Import GEE Data Extractor and Model Deployer
from gee_extractor import GEEDataExtractor
from deploy import ModelDeployer
from trainer import ModelTrainer

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# More comprehensive CORS setup
CORS(app, 
     resources={r"/*": {
         "origins": ["http://localhost:8000", "http://127.0.0.1:8000"],
         "allow_headers": ["Content-Type", "Authorization"],
         "methods": ["GET", "POST", "OPTIONS"],
         "supports_credentials": True
     }})

# Add CORS headers to all responses
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    response.headers.add('Access-Control-Allow-Credentials', 'true')
    return response

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Constants
PROJECTS_DIR = "projects"
BUFFER_SIZES = {
    'S2': 10,  # 10m resolution for Sentinel-2
    'S1': 10   # 10m resolution for Sentinel-1
}

os.makedirs(PROJECTS_DIR, exist_ok=True)

@app.route('/list_projects', methods=['GET'])
def list_projects():
    try:
        # Get list of projects (directories in the PROJECTS_DIR)
        projects = []
        for item in os.listdir(PROJECTS_DIR):
            project_dir = os.path.join(PROJECTS_DIR, item)
            if os.path.isdir(project_dir):
                # Get creation time and last modified time
                created = datetime.datetime.fromtimestamp(os.path.getctime(project_dir)).strftime('%Y-%m-%d %H:%M:%S')
                modified = datetime.datetime.fromtimestamp(os.path.getmtime(project_dir)).strftime('%Y-%m-%d %H:%M:%S')
                
                # Check for master points file first
                master_points_file = os.path.join(project_dir, 'points.geojson')
                total_points = 0
                latest_export = 'points.geojson'  # Default to master file
                
                if os.path.exists(master_points_file):
                    try:
                        # Count points in master file
                        gdf = gpd.read_file(master_points_file)
                        total_points = len(gdf)
                    except Exception as e:
                        print(f"Error reading master points file: {str(e)}")
                else:
                    # Fall back to legacy files if no master file
                    geojson_files = [f for f in os.listdir(project_dir) if f.endswith('.geojson')]
                    
                    # Get the latest export if any
                    latest_export = None
                    latest_export_time = None
                    
                    for gj_file in geojson_files:
                        file_path = os.path.join(project_dir, gj_file)
                        file_time = os.path.getmtime(file_path)
                        
                        if latest_export_time is None or file_time > latest_export_time:
                            latest_export = gj_file
                            latest_export_time = file_time
                        
                        try:
                            # Count points in each file
                            gdf = gpd.read_file(file_path)
                            total_points += len(gdf)
                        except Exception as e:
                            print(f"Error reading {gj_file}: {str(e)}")
                
                # Check for extracted data
                extracted_dir = os.path.join(project_dir, "extracted_data")
                has_extracted_data = os.path.exists(extracted_dir) and len(os.listdir(extracted_dir)) > 0
                extracted_files = []
                
                if has_extracted_data:
                    # Get all netCDF files in the extracted_data directory
                    extracted_files = [f for f in os.listdir(extracted_dir) if f.endswith('.nc')]
                
                projects.append({
                    'name': item,
                    'created': created,
                    'modified': modified,
                    'total_points': total_points,
                    'latest_export': latest_export,
                    'has_extracted_data': has_extracted_data,
                    'extracted_files': len(extracted_files)
                })
        
        return jsonify({
            "success": True,
            "projects": projects
        })
        
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/create_project', methods=['POST'])
def create_project():
    try:
        # Get the project name from the request
        data = request.json
        project_name = data.get('name', '').strip()
        
        if not project_name:
            return jsonify({"success": False, "message": "Project name is required"}), 400
        
        # Create a safe directory name (replace spaces and special chars)
        safe_name = ''.join(c if c.isalnum() else '_' for c in project_name)
        
        # Check if project already exists
        project_dir = os.path.join(PROJECTS_DIR, safe_name)
        if os.path.exists(project_dir):
            return jsonify({"success": False, "message": f"Project '{project_name}' already exists"}), 400
        
        # Create project directory
        os.makedirs(project_dir)
        
        # Create a project info file
        project_info = {
            'name': project_name,
            'created': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'description': data.get('description', '')
        }
        
        with open(os.path.join(project_dir, 'project_info.json'), 'w') as f:
            json.dump(project_info, f, indent=2)
        
        return jsonify({
            "success": True,
            "message": f"Project '{project_name}' created successfully",
            "project_id": safe_name
        })
        
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/delete_project', methods=['POST'])
def delete_project():
    try:
        # Get the project id from the request
        data = request.json
        project_id = data.get('project_id', '')
        
        if not project_id:
            return jsonify({"success": False, "message": "Project ID is required"}), 400
        
        # Check if project exists
        project_dir = os.path.join(PROJECTS_DIR, project_id)
        if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
            return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
        
        # Delete project directory and all contents
        shutil.rmtree(project_dir)
        
        return jsonify({
            "success": True,
            "message": f"Project '{project_id}' deleted successfully"
        })
        
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/export_points', methods=['POST'])
def export_points():
    try:
        # Get the GeoJSON data and project ID from the request
        data = request.json
        geojson = data.get('geojson', {})
        project_id = data.get('project_id', '')
        
        print(f"Exporting points for project: {project_id}")
        
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
        print(f"Received {len(features)} features")
        
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
                print(f"Old features: {len(old_features)}, New features: {len(features)}")
                
                # Extract old point IDs
                old_ids = set()
                for feature in old_features:
                    if 'properties' in feature and 'id' in feature['properties']:
                        old_ids.add(str(feature['properties']['id']))
                
                # Find removed points
                if len(old_features) > len(features):
                    removed_ids = old_ids - new_ids
                    
                    if removed_ids:
                        print(f"Found {len(removed_ids)} removed points: {removed_ids}")
                        # Clean up extracted data for removed points
                        cleanup_extracted_data(project_id, removed_ids)
                    else:
                        print("No points were removed (IDs don't match)")
                else:
                    print("No points were removed (count check)")
            except Exception as e:
                print(f"Error checking for removed points: {str(e)}")
                print(f"Traceback: {traceback.format_exc()}")
        
        # Convert to GeoDataFrame 
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
        
        print(f"Updated master points file with {len(new_gdf)} points, total: {point_counts['total']}")
        print(f"  - Positive: {point_counts['positive']}")
        print(f"  - Negative: {point_counts['negative']}")
        
        # Return success response
        return jsonify({
            "success": True,
            "message": f"Saved {point_counts['total']} points to master file",
            "filename": "points.geojson",
            "counts": point_counts
        })
        
    except Exception as e:
        print(f"Error exporting points: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": str(e)}), 500

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
        
        print(f"Cleaning up extracted data for project {project_id}")
        print(f"Removed point IDs: {removed_point_ids}")
        
        # Convert all removed_point_ids to strings to ensure consistent comparison
        removed_point_ids = {str(pid) for pid in removed_point_ids}
        
        if not os.path.exists(extracted_dir):
            print(f"No extracted_data directory found at {extracted_dir}")
            return
        
        # Get all netCDF files
        nc_files = [f for f in os.listdir(extracted_dir) if f.endswith('.nc')]
        print(f"Found {len(nc_files)} netCDF files to check")
        
        for nc_file in nc_files:
            file_path = os.path.join(extracted_dir, nc_file)
            print(f"Processing file: {nc_file}")
            
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
                        
                        print(f"Points to keep: {len(keep_indices)}, Points to remove: {len(removed_indices)}")
                        if removed_indices:
                            print(f"Removing point indices: {removed_indices}")
                            print(f"Removing point IDs: {[point_ids[i] for i in removed_indices]}")
                        
                        if len(keep_indices) < len(point_ids):
                            # Create a new dataset without the removed points
                            print(f"Creating new dataset with {len(keep_indices)} points")
                            new_ds = ds.isel(point=keep_indices)
                            
                            # Ensure label has a consistent data type
                            if 'label' in new_ds:
                                # Convert label to string if it's an object type
                                if new_ds.label.dtype == 'O':
                                    print(f"Converting label from {new_ds.label.dtype} to string type")
                                    new_ds['label'] = new_ds.label.astype(str)
                            
                            # Check for other object dtypes that might cause issues
                            for var_name, var in new_ds.variables.items():
                                if var.dtype == 'O':
                                    print(f"Warning: Variable '{var_name}' has object dtype which may cause serialization issues")
                                    try:
                                        # Try to convert to string
                                        new_ds[var_name] = var.astype(str)
                                        print(f"Converted '{var_name}' to string type")
                                    except Exception as e:
                                        print(f"Could not convert '{var_name}' to string: {e}")
                            
                            # Save to a temporary file
                            temp_file = file_path + '.temp'
                            try:
                                new_ds.to_netcdf(temp_file)
                                
                                # Close the dataset
                                new_ds.close()
                                
                                # Replace the original file
                                os.replace(temp_file, file_path)
                                
                                print(f"Successfully removed data for {len(point_ids) - len(keep_indices)} points from {nc_file}")
                            except Exception as e:
                                print(f"Error saving modified dataset: {e}")
                                print(f"Dataset variables: {list(new_ds.variables.keys())}")
                                print(f"Dataset dtypes: {[(name, var.dtype) for name, var in new_ds.variables.items()]}")
                                new_ds.close()
                                # Clean up temp file if it exists
                                if os.path.exists(temp_file):
                                    try:
                                        os.remove(temp_file)
                                    except:
                                        pass
                                raise
                        else:
                            print(f"No points to remove from {nc_file}")
                    else:
                        # If no point_id variable, try to match by coordinates
                        print(f"No point_id variable found in {nc_file}, trying to match by coordinates")
                        
                        # Load the points.geojson file to get coordinates of removed points
                        points_file = os.path.join(project_dir, "points.geojson")
                        if os.path.exists(points_file):
                            try:
                                # Load the GeoJSON file
                                with open(points_file, 'r') as f:
                                    geojson = json.load(f)
                                
                                # Get coordinates of all points
                                all_points = {}
                                for feature in geojson.get('features', []):
                                    if 'properties' in feature and 'id' in feature['properties']:
                                        point_id = str(feature['properties']['id'])
                                        coords = feature['geometry']['coordinates']
                                        all_points[point_id] = coords
                                
                                # Get coordinates of removed points
                                removed_coords = [all_points[pid] for pid in removed_point_ids if pid in all_points]
                                
                                # Get dataset coordinates
                                ds_lons = ds.longitude.values
                                ds_lats = ds.latitude.values
                                
                                # Find indices to keep
                                keep_indices = []
                                removed_indices = []
                                for i in range(len(ds_lons)):
                                    keep = True
                                    for lon, lat in removed_coords:
                                        # Check if coordinates match (with small tolerance)
                                        if (abs(ds_lons[i] - lon) < 1e-6 and 
                                            abs(ds_lats[i] - lat) < 1e-6):
                                            keep = False
                                            removed_indices.append(i)
                                            break
                                    if keep:
                                        keep_indices.append(i)
                                
                                print(f"Points to keep: {len(keep_indices)}, Points to remove: {len(removed_indices)}")
                                
                                if len(keep_indices) < len(ds_lons):
                                    # Create a new dataset without the removed points
                                    print(f"Creating new dataset with {len(keep_indices)} points")
                                    new_ds = ds.isel(point=keep_indices)
                                    
                                    # Ensure label has a consistent data type
                                    if 'label' in new_ds:
                                        # Convert label to string if it's an object type
                                        if new_ds.label.dtype == 'O':
                                            print(f"Converting label from {new_ds.label.dtype} to string type")
                                            new_ds['label'] = new_ds.label.astype(str)
                                    
                                    # Check for other object dtypes that might cause issues
                                    for var_name, var in new_ds.variables.items():
                                        if var.dtype == 'O':
                                            print(f"Warning: Variable '{var_name}' has object dtype which may cause serialization issues")
                                            try:
                                                # Try to convert to string
                                                new_ds[var_name] = var.astype(str)
                                                print(f"Converted '{var_name}' to string type")
                                            except Exception as e:
                                                print(f"Could not convert '{var_name}' to string: {e}")
                                    
                                    # Save to a temporary file
                                    temp_file = file_path + '.temp'
                                    try:
                                        new_ds.to_netcdf(temp_file)
                                        
                                        # Close the dataset
                                        new_ds.close()
                                        
                                        # Replace the original file
                                        os.replace(temp_file, file_path)
                                        
                                        print(f"Successfully removed data for {len(ds_lons) - len(keep_indices)} points from {nc_file} using coordinate matching")
                                    except Exception as e:
                                        print(f"Error saving modified dataset: {e}")
                                        print(f"Dataset variables: {list(new_ds.variables.keys())}")
                                        print(f"Dataset dtypes: {[(name, var.dtype) for name, var in new_ds.variables.items()]}")
                                        new_ds.close()
                                        # Clean up temp file if it exists
                                        if os.path.exists(temp_file):
                                            try:
                                                os.remove(temp_file)
                                            except:
                                                pass
                                        raise
                                else:
                                    print(f"No points to remove from {nc_file} using coordinate matching")
                            except Exception as e:
                                print(f"Error matching by coordinates: {str(e)}")
                                print(f"Traceback: {traceback.format_exc()}")
            except Exception as e:
                print(f"Error processing {nc_file}: {str(e)}")
                print(f"Traceback: {traceback.format_exc()}")
    
    except Exception as e:
        print(f"Error cleaning up extracted data: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")

@app.route('/list_exports', methods=['GET'])
def list_exports():
    try:
        # Get the project id from the query parameters
        project_id = request.args.get('project_id', '')
        
        if not project_id:
            return jsonify({"success": False, "message": "Project ID is required"}), 400
        
        # Check if project exists
        project_dir = os.path.join(PROJECTS_DIR, project_id)
        if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
            return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
        
        exports = []
        
        # Check for the master points file
        master_file = os.path.join(project_dir, 'points.geojson')
        if os.path.exists(master_file):
            try:
                gdf = gpd.read_file(master_file)
                positive_count = len(gdf[gdf['class'] == 'positive'])
                negative_count = len(gdf[gdf['class'] == 'negative'])
                
                exports.append({
                    'filename': 'points.geojson',
                    'created': datetime.datetime.fromtimestamp(os.path.getctime(master_file)).strftime('%Y-%m-%d %H:%M:%S'),
                    'modified': datetime.datetime.fromtimestamp(os.path.getmtime(master_file)).strftime('%Y-%m-%d %H:%M:%S'),
                    'total_points': len(gdf),
                    'positive_points': positive_count,
                    'negative_points': negative_count
                })
            except Exception as e:
                print(f"Error reading master points file: {str(e)}")
                
        # For compatibility, also include any other geojson files, but only if master file doesn't exist
        if not os.path.exists(master_file):
            legacy_files = [f for f in os.listdir(project_dir) if f.endswith('.geojson') and f != 'points.geojson']
            legacy_files.sort(reverse=True)  # Most recent first
            
            for file in legacy_files:
                filepath = os.path.join(project_dir, file)
                try:
                    gdf = gpd.read_file(filepath)
                    positive_count = len(gdf[gdf['class'] == 'positive'])
                    negative_count = len(gdf[gdf['class'] == 'negative'])
                    
                    exports.append({
                        'filename': file,
                        'created': datetime.datetime.fromtimestamp(os.path.getctime(filepath)).strftime('%Y-%m-%d %H:%M:%S'),
                        'total_points': len(gdf),
                        'positive_points': positive_count,
                        'negative_points': negative_count
                    })
                except Exception as e:
                    print(f"Error reading point file {file}: {str(e)}")
        
        return jsonify({
            "success": True, 
            "exports": exports
        })
        
    except Exception as e:
        print(f"Error listing exports: {str(e)}")
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
        
        print(f"list_extracted_data called for project: {project_id}")
        
        if not project_id:
            return jsonify({"success": False, "message": "Project ID is required"}), 400
        
        # Check if project exists
        project_dir = os.path.join(PROJECTS_DIR, project_id)
        if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
            return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
        
        # Check if extracted_data directory exists
        extracted_dir = os.path.join(project_dir, "extracted_data")
        if not os.path.exists(extracted_dir):
            print(f"No extracted_data directory found at {extracted_dir}")
            return jsonify({"success": True, "extractions": []})
        
        # Get all netCDF files
        nc_files = [f for f in os.listdir(extracted_dir) if f.endswith('.nc')]
        print(f"Found {len(nc_files)} netCDF files in {extracted_dir}:")
        for file in nc_files:
            print(f"  - {file}")
        
        if len(nc_files) == 0:
            return jsonify({"success": True, "extractions": []})
        
        # Look for unified data files
        extractions = []
        
        # Look for any file with "extracted_data.nc" in the name - these are unified files
        unified_files = [f for f in nc_files if "extracted_data.nc" in f]
        print(f"Found {len(unified_files)} unified files: {unified_files}")
        
        if unified_files:
            # Process any unified data files first
            for nc_file in unified_files:
                # Find corresponding metadata file
                base_name = nc_file.rsplit('.', 1)[0]
                metadata_file = f"{base_name}_metadata.json"
                metadata_path = os.path.join(extracted_dir, metadata_file)
                
                print(f"Looking for metadata file: {metadata_path}")
                
                file_path = os.path.join(extracted_dir, nc_file)
                file_size = os.path.getsize(file_path) / (1024 * 1024)  # Convert to MB
                
                if os.path.exists(metadata_path):
                    with open(metadata_path, 'r') as f:
                        metadata = json.load(f)
                    
                    # For unified files, use the last_updated field
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
                    'unified': True,
                    'file_size_mb': round(file_size, 2)
                }
                extractions.append(extraction_data)
                print(f"Added unified file to extractions: {nc_file}")
            
            # If we found unified files, just return those and skip legacy files
            if extractions:
                # Sort by creation time, most recent first
                extractions.sort(key=lambda x: x.get('last_updated', x.get('created', '')), reverse=True)
                
                return jsonify({
                    "success": True, 
                    "extractions": extractions
                })
        
        # If no unified files found, process legacy files
        legacy_files = [f for f in nc_files if "extracted_data.nc" not in f]
        print(f"Processing {len(legacy_files)} legacy files")
        
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
                    'unified': False,
                    'file_size_mb': round(file_size, 2)
                }
                extractions.append(extraction_data)
        
        print(f"Returning {len(extractions)} extractions:")
        for ext in extractions:
            print(f"  - {ext['filename']} (unified: {ext['unified']})")
        
        # Sort by creation time, most recent first
        extractions.sort(key=lambda x: x.get('last_updated', x.get('extraction_time', x.get('created', ''))), reverse=True)
        
        return jsonify({
            "success": True, 
            "extractions": extractions
        })
        
    except Exception as e:
        print(f"Error in list_extracted_data: {str(e)}")
        return jsonify({"success": False, "message": str(e)}), 500

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

# Updated version of the endpoint
@app.route('/get_patch_visualization', methods=['GET'])
def get_patch_visualization():
    try:
        # Get query parameters
        project_id = request.args.get('project_id', '')
        extraction_file = request.args.get('file', '')
        visualization_type = request.args.get('vis_type', 'true_color')
        check_only = request.args.get('check_only', 'false').lower() == 'true'
        
        print(f"get_patch_visualization called: project={project_id}, file={extraction_file}, type={visualization_type}, check_only={check_only}")
        
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
        
        # If no specific file is provided, look for unified data file
        if not extraction_file:
            # Get all .nc files
            nc_files = [f for f in os.listdir(extracted_dir) if f.endswith('.nc')]
            
            # Look for any file with "extracted_data.nc" in the name - these are unified files
            unified_files = [f for f in nc_files if "extracted_data.nc" in f]
            
            if unified_files:
                # Sort by modification time (most recent first)
                unified_files.sort(key=lambda f: os.path.getmtime(os.path.join(extracted_dir, f)), reverse=True)
                extraction_file = unified_files[0]
            else:
                # No unified file found, try to get the most recent file
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
                        
                        # Create a colormap for NDVI
                        plt.ioff()  # Turn off interactive mode
                        fig, ax = plt.subplots(figsize=(3, 3), dpi=100)
                        cmap = plt.cm.RdYlGn
                        norm = colors.Normalize(vmin=-1, vmax=1)
                        ax.imshow(ndvi, cmap=cmap, norm=norm)
                        ax.axis('off')
                        
                        # Convert figure to image
                        buf = io.BytesIO()
                        fig.savefig(buf, format='png', bbox_inches='tight', pad_inches=0)
                        plt.close(fig)
                        buf.seek(0)
                        
                        # Convert to numpy array
                        img = Image.open(buf)
                        img_data = np.array(img)[:, :, :3] / 255.0  # Remove alpha channel and normalize
            
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

@app.route('/train_model', methods=['POST'])
def train_model():
    try:
        # Get parameters from the request
        data = request.json
        project_id = data.get('project_id', '')
        extraction_files = data.get('extraction_files', [])
        model_name = data.get('model_name', '')
        batch_size = data.get('batch_size', 32)
        epochs = data.get('epochs', 10)
        test_split = data.get('test_split', 0.3)  # Use test_split instead of validation_split
        augmentation = data.get('augmentation', True)  # Add augmentation parameter which may be expected
        
        # If special "auto_detect" value is provided or extraction_files is empty, let the backend find the files
        auto_detect = 'auto_detect' in extraction_files or not extraction_files
        
        if not project_id:
            return jsonify({"success": False, "message": "Project ID is required"}), 400
        
        if not model_name:
            return jsonify({"success": False, "message": "Model name is required"}), 400
        
        # Check if the project exists
        project_dir = os.path.join(PROJECTS_DIR, project_id)
        if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
            return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
        
        # Check if extracted_data directory exists
        extracted_dir = os.path.join(project_dir, "extracted_data")
        if not os.path.exists(extracted_dir):
            return jsonify({"success": False, "message": "No extracted data found"}), 404
        
        # If auto_detect is true or no extraction files are provided, look for unified data files
        if auto_detect:
            extraction_files = []  # Reset the list
            # Get all .nc files
            nc_files = [f for f in os.listdir(extracted_dir) if f.endswith('.nc')]
            
            # Look for any file with "extracted_data.nc" in the name - these are unified files
            unified_files = [f for f in nc_files if "extracted_data.nc" in f]
            
            if unified_files:
                # Sort by modification time (most recent first)
                unified_files.sort(key=lambda f: os.path.getmtime(os.path.join(extracted_dir, f)), reverse=True)
                extraction_files = [unified_files[0]]
                logger.info(f"Auto-detected unified data file: {unified_files[0]}")
            else:
                # No unified file found, try to get the most recent file
                if nc_files:
                    # Sort by modification time (most recent first)
                    nc_files.sort(key=lambda f: os.path.getmtime(os.path.join(extracted_dir, f)), reverse=True)
                    extraction_files = [nc_files[0]]
                    logger.info(f"Auto-detected legacy data file: {nc_files[0]}")
                else:
                    return jsonify({"success": False, "message": "No extracted data files found"}), 404
        
        # Validate that the extraction files exist
        for file in extraction_files:
            file_path = os.path.join(extracted_dir, file)
            if not os.path.exists(file_path):
                return jsonify({"success": False, "message": f"Extraction file '{file}' not found"}), 404
        
        # Create a progress callback function
        def progress_callback(progress, current_epoch, total_epochs, logs):
            # Send progress updates via Socket.IO
            socketio.emit('training_progress', {
                'project_id': project_id,
                'progress': progress,
                'current_epoch': current_epoch,
                'total_epochs': total_epochs,
                'logs': logs
            })
        
        # Log the files that will be used for training
        logger.info(f"Training model '{model_name}' with files: {extraction_files}")
        
        # Initialize model trainer
        trainer = ModelTrainer(project_id, project_dir)
        
        # Train the model with parameters that match the ModelTrainer.train() method signature
        result = trainer.train(
            model_name=model_name,
            extraction_files=extraction_files,
            batch_size=batch_size,
            epochs=epochs,
            test_split=test_split,
            augmentation=augmentation,
            progress_callback=progress_callback
        )
        
        if result['success']:
            # Send completion message
            socketio.emit('training_complete', {
                'project_id': project_id,
                'model_name': model_name,
                'metrics': result['metadata']['final_metrics']
            })
            
            return jsonify(result)
        else:
            # Send error message
            socketio.emit('training_error', {
                'project_id': project_id,
                'error': result['message']
            })
            return jsonify(result), 500
            
    except Exception as e:
        logger.error(f"Error training model: {str(e)}")
        socketio.emit('training_error', {
            'project_id': project_id,
            'error': str(e)
        })
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/list_models', methods=['GET'])
def list_models():
    try:
        # Get the project id from the query parameters
        project_id = request.args.get('project_id', '')
        
        if not project_id:
            return jsonify({"success": False, "message": "Project ID is required"}), 400
        
        # Check if project exists
        project_dir = os.path.join(PROJECTS_DIR, project_id)
        if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
            return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
        
        # Check if models directory exists
        models_dir = os.path.join(project_dir, "models")
        if not os.path.exists(models_dir):
            return jsonify({"success": True, "models": []})
        
        # Get all model files
        models = []
        for file in os.listdir(models_dir):
            if file.endswith('_metadata.json'):
                model_name = file.replace('_metadata.json', '')
                metadata_path = os.path.join(models_dir, file)
                
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)
                    
                model_path = os.path.join(models_dir, f"{model_name}.h5")
                file_size = os.path.getsize(model_path) / (1024 * 1024)  # Convert to MB
                
                models.append({
                    'name': model_name,
                    'created': metadata['created'],
                    'file_size_mb': round(file_size, 2),
                    'metrics': metadata['final_metrics'],
                    'input_shape': metadata['input_shape'],
                    'extraction_files': metadata['extraction_files']
                })
        
        # Sort by creation time (newest first)
        models.sort(key=lambda x: x['created'], reverse=True)
        
        return jsonify({
            "success": True,
            "models": models
        })
        
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

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
        tile_padding = data.get('tile_padding', 24)
        batch_size = data.get('batch_size', 500)
        tries = data.get('tries', 2)
        
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
        deployer = ModelDeployer(project_id)
        
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
            tile_padding=tile_padding,
            batch_size=batch_size,
            tries=tries,
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
        
        # Ensure we have a valid GeoJSON structure even if predictions is empty
        if len(predictions) == 0:
            app.logger.info("No predictions found, creating empty GeoJSON structure")
            predictions_geojson = json.dumps({
                "type": "FeatureCollection",
                "features": []
            })
        
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
            'properties': {}
        }
        
        app.logger.info(f"Created bounding box: {bounding_box}")  # Debug log
        
        # Parse the GeoJSON and ensure it's valid before sending
        prediction_data = json.loads(predictions_geojson)
        
        # Validate GeoJSON structure
        if 'features' not in prediction_data:
            prediction_data = {"type": "FeatureCollection", "features": []}
        
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
                            "properties": {}
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
                            "properties": {}
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
                    "properties": {}
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
        app.logger.error(f"Error deploying model: {str(e)}")
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
        tile_size = int(request.args.get('tile_size', 576))
        
        if not project_id or not region:
            return jsonify({"success": False, "message": "Project ID and region are required"}), 400
        
        # Check if project exists
        project_dir = os.path.join(PROJECTS_DIR, project_id)
        if not os.path.exists(project_dir) or not os.path.isdir(project_dir):
            return jsonify({"success": False, "message": f"Project '{project_id}' not found"}), 404
        
        # Initialize model deployer to calculate tiles
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
        
        # No longer generating a static image URL - using only tile-based approach
        
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
        
        print(f"Checking if {file_path} exists: {file_exists}")
        
        return jsonify({
            "success": True,
            "file_exists": file_exists,
            "project_id": project_id,
            "filename": filename
        })
    
    except Exception as e:
        print(f"Error in check_file_exists: {str(e)}")
        return jsonify({"success": False, "message": str(e)}), 500

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5001)


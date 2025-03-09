from flask import request, jsonify
import os
import datetime
import json
import shutil
import geopandas as gpd
import logging

from config import PROJECTS_DIR

logger = logging.getLogger(__name__)

def register_projects_endpoints(app, socketio):
    """Register all project-related endpoints"""
    
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
                            logger.error(f"Error reading master points file: {str(e)}")
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
                                logger.error(f"Error reading {gj_file}: {str(e)}")
                    
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

    # Add more project-related endpoints here...
    
    # Return routes for documentation purposes
    documented_routes = {
        "list_projects": "GET /list_projects - List all projects",
        "create_project": "POST /create_project - Create a new project",
        "delete_project": "POST /delete_project - Delete a project"
    }
    
    return documented_routes
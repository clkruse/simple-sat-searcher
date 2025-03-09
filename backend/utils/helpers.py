"""
Helper functions for the satellite imagery processing application.
"""
import os
import logging
import json
import datetime
import numpy as np
from shapely.geometry import Point

logger = logging.getLogger(__name__)

class NumpyEncoder(json.JSONEncoder):
    """JSON encoder that can handle NumPy data types."""
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(NumpyEncoder, self).default(obj)

def ensure_directory(directory_path):
    """
    Ensure a directory exists, create it if it doesn't.
    
    Args:
        directory_path (str): Path to the directory
        
    Returns:
        str: Path to the directory
    """
    if not os.path.exists(directory_path):
        os.makedirs(directory_path, exist_ok=True)
        logger.info(f"Created directory: {directory_path}")
    return directory_path

def get_project_dir(projects_dir, project_id):
    """
    Get the directory for a specific project.
    
    Args:
        projects_dir (str): Base directory for all projects
        project_id (str): ID of the project
        
    Returns:
        str: Path to the project directory
    """
    project_dir = os.path.join(projects_dir, project_id)
    return ensure_directory(project_dir)

def get_safe_filename(name):
    """
    Convert a string to a safe filename.
    
    Args:
        name (str): String to convert
        
    Returns:
        str: Safe filename
    """
    return ''.join(c if c.isalnum() else '_' for c in name)

def format_timestamp(timestamp=None):
    """
    Format a timestamp for filenames.
    
    Args:
        timestamp (datetime, optional): Timestamp to format. Defaults to current time.
        
    Returns:
        str: Formatted timestamp
    """
    if timestamp is None:
        timestamp = datetime.datetime.now()
    return timestamp.strftime('%Y%m%d_%H%M%S')

def get_file_size_mb(file_path):
    """
    Get the size of a file in megabytes.
    
    Args:
        file_path (str): Path to the file
        
    Returns:
        float: Size in megabytes
    """
    size_bytes = os.path.getsize(file_path)
    return size_bytes / (1024 * 1024)

def load_geojson(file_path):
    """
    Load a GeoJSON file.
    
    Args:
        file_path (str): Path to the GeoJSON file
        
    Returns:
        dict: Loaded GeoJSON data
    """
    try:
        with open(file_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading GeoJSON file {file_path}: {e}")
        raise

def geojson_to_points(geojson):
    """
    Convert GeoJSON to a list of points with attributes.
    
    Args:
        geojson (dict): GeoJSON data
        
    Returns:
        list: List of dictionaries with point data
    """
    points = []
    for feature in geojson.get('features', []):
        if 'geometry' in feature and feature['geometry']['type'] == 'Point':
            coords = feature['geometry']['coordinates']
            point = {
                'geometry': Point(coords[0], coords[1]),
                'class': feature.get('properties', {}).get('class', 'unknown')
            }
            
            # Include ID if available
            if 'id' in feature.get('properties', {}):
                point['id'] = feature['properties']['id']
            
            points.append(point)
    
    return points

def is_valid_date(date_string):
    """
    Check if a string is a valid date in YYYY-MM-DD format.
    
    Args:
        date_string (str): Date string to check
        
    Returns:
        bool: True if valid, False otherwise
    """
    try:
        datetime.datetime.strptime(date_string, '%Y-%m-%d')
        return True
    except ValueError:
        return False
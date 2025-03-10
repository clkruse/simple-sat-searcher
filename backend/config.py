import os

# Project directory
PROJECTS_DIR = os.environ.get('PROJECTS_DIR', "static/projects")

# Create projects directory if it doesn't exist
os.makedirs(PROJECTS_DIR, exist_ok=True)

# CORS settings
CORS_ORIGINS = ["http://localhost:8000", "http://127.0.0.1:8000"]

# Buffer sizes for different satellite collections
BUFFER_SIZES = {
    'S2': 10,  # 10m resolution for Sentinel-2
    'S1': 10   # 10m resolution for Sentinel-1
}

# Band IDs for different collections
BAND_IDS = {
    "S1": ["VV", "VH"],  
    "S2": ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8A", "B8", "B9", "B11", "B12"]
}

# Earth Engine project ID
EE_PROJECT = "earth-engine-ck"
from flask import Flask, request
from flask_cors import CORS
from flask_socketio import SocketIO
import logging
import os

# Import API endpoint registration functions
from api.projects import register_projects_endpoints
from api.extraction import register_extraction_endpoints
from api.training import register_training_endpoints
from api.deployment import register_deployment_endpoints

# Import configuration
from config import PROJECTS_DIR, CORS_ORIGINS

# Configure logging
logging.basicConfig(level=logging.INFO,
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Initialize Flask application
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# Configure CORS
CORS(app, 
     resources={r"/*": {
         "origins": CORS_ORIGINS,
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

# Ensure project directories exist
os.makedirs(PROJECTS_DIR, exist_ok=True)
logger.info(f"Using projects directory: {PROJECTS_DIR}")

# Application initialization
def initialize_app():
    """Initialize the application components."""
    logger.info("Initializing application...")
    
    # Register API endpoints from each module
    logger.info("Registering API endpoints...")
    register_projects_endpoints(app, socketio)
    register_extraction_endpoints(app, socketio)
    register_training_endpoints(app, socketio)
    register_deployment_endpoints(app, socketio)
    
    logger.info("Application initialization complete")

# Health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    """Simple health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.datetime.now().isoformat(),
        "version": "1.0.0"
    }

# Root endpoint with API information
@app.route('/', methods=['GET'])
def api_info():
    """Root endpoint with API information."""
    return {
        "name": "Satellite Imagery Processing API",
        "version": "1.0.0",
        "endpoints": {
            "projects": "/list_projects, /create_project, /delete_project, /export_points, /load_points",
            "extraction": "/extract_data, /list_extracted_data, /get_patch_visualization, /get_map_imagery",
            "training": "/train_model, /list_models",
            "deployment": "/deploy_model, /get_deployment_tiles"
        },
        "documentation": "See README.md for full documentation"
    }

# Initialize the application
initialize_app()

# Run the application
if __name__ == '__main__':
    import datetime
    logger.info(f"Starting server at {datetime.datetime.now().isoformat()}")
    socketio.run(app, debug=True, port=5001)
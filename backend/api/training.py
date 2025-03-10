"""
Endpoints for model training
"""
from flask import request, jsonify
import os
import logging

from config import PROJECTS_DIR
from models.trainer import ModelTrainer

logger = logging.getLogger(__name__)

def register_training_endpoints(app, socketio):
    """Register all training-related endpoints"""
    
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
            test_split = data.get('test_split', 0.3)
            augmentation = data.get('augmentation', True)
            
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
            
            # If auto_detect is true or no extraction files are provided, look for project data files
            if auto_detect:
                extraction_files = []  # Reset the list
                # Get all .nc files
                nc_files = [f for f in os.listdir(extracted_dir) if f.endswith('.nc')]
                
                # Look for any file with "extracted_data.nc" in the name - these are project data files
                project_data_files = [f for f in nc_files if "extracted_data.nc" in f]
                
                if project_data_files:
                    # Sort by modification time (most recent first)
                    project_data_files.sort(key=lambda f: os.path.getmtime(os.path.join(extracted_dir, f)), reverse=True)
                    extraction_files = [project_data_files[0]]
                    logger.info(f"Auto-detected project data file: {project_data_files[0]}")
                else:
                    # No project data file found, try to get the most recent file
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
                        import json
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

    # Return routes for documentation purposes
    documented_routes = {
        "train_model": "POST /train_model - Train a model",
        "list_models": "GET /list_models - List trained models for a project"
    }
    
    return documented_routes
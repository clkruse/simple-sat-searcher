# Satellite Imagery Processing Backend

This is the backend service for the satellite imagery processing application. It provides APIs for managing projects, extracting satellite data, training models, and deploying models for predictions.

## Directory Structure

```
backend/
├── app.py               # Application entry point
├── config.py            # Configuration settings
├── requirements.txt     # Dependencies
│
├── api/                 # API endpoints
│   ├── projects.py      # Project management endpoints
│   ├── extraction.py    # Data extraction endpoints
│   ├── training.py      # Model training endpoints
│   └── deployment.py    # Model deployment endpoints
│
├── models/              # Model-related functionality
│   └── trainer.py       # Model training logic
│
├── services/            # Services and utilities
│   ├── gee_service.py   # Google Earth Engine extractor
│   └── deploy_service.py # Model deployment service
│
└── utils/               # Utility functions
    └── helpers.py       # Common helper functions
```

## Installation

1. Create a virtual environment:
   ```
   python -m venv venv
   ```

2. Activate the virtual environment:
   - On Windows: `venv\Scripts\activate`
   - On macOS/Linux: `source venv/bin/activate`

3. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

4. Set up Google Earth Engine authentication:
   ```
   earthengine authenticate
   ```

## Configuration

Update `config.py` with your configuration settings:

- `PROJECTS_DIR`: Directory to store project data
- `EE_PROJECT`: Your Google Earth Engine project ID
- `CORS_ORIGINS`: Allowed CORS origins for frontend access

## Running the Application

Start the Flask application:

```
python app.py
```

The server will start on port 5001 by default.

## API Endpoints

### Projects
- `GET /list_projects` - List all projects
- `POST /create_project` - Create a new project
- `POST /delete_project` - Delete a project
- `POST /export_points` - Export points to a project
- `GET /load_points` - Load points from a project

### Extraction
- `POST /extract_data` - Extract satellite data for points
- `GET /list_extracted_data` - List extracted data for a project
- `GET /get_patch_visualization` - Get visualization for extracted data
- `GET /get_map_imagery` - Get map imagery for a region

### Training
- `POST /train_model` - Train a model
- `GET /list_models` - List trained models for a project

### Deployment
- `POST /deploy_model` - Deploy a trained model to make predictions
- `GET /get_deployment_tiles` - Get tile geometries for deployment

## WebSocket Events

The application uses Socket.IO for real-time updates:

- `extraction_progress` - Progress updates during extraction
- `extraction_complete` - Notification when extraction is complete
- `extraction_error` - Error notification during extraction
- `training_progress` - Progress updates during model training
- `training_complete` - Notification when training is complete
- `training_error` - Error notification during training
- `deployment_progress` - Progress updates during model deployment
- `deployment_log` - Log messages during deployment
- `deployment_complete` - Notification when deployment is complete
- `deployment_error` - Error notification during deployment

## Data Flow

1. **Project Creation**: Create a project to organize your data
2. **Point Management**: Add labeled points (positive/negative) to your project
3. **Data Extraction**: Extract satellite imagery from Google Earth Engine for your points
4. **Model Training**: Train a machine learning model using the extracted data
5. **Model Deployment**: Deploy the trained model to make predictions on new areas

## Error Handling

All API endpoints return a consistent JSON response format:

```json
{
  "success": true|false,
  "message": "Success or error message",
  "data": { ... }  // Optional data payload
}
```

## Development

### Adding a New Endpoint

1. Create a new function in the appropriate API module
2. Register the endpoint with Flask in the relevant registration function
3. Update the `documented_routes` dictionary for documentation

### Creating a New Module

1. Create a new Python file in the appropriate directory
2. Define any needed classes or functions
3. Update the imports in `app.py` if necessary

## Troubleshooting

### Common Issues

- **Earth Engine Authentication**: Ensure you have authenticated with Google Earth Engine
- **Missing Projects Directory**: The directory specified in `PROJECTS_DIR` must exist
- **Socket.IO Connection Issues**: Check CORS settings in `config.py`

### Logging

Logs are written to the console with detailed information about operations and errors.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
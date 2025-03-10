# Satellite Imagery Processing Frontend

This is the frontend application for the satellite imagery processing project. It provides a user interface for managing projects, labeling points on maps, extracting satellite data, training models, and deploying models for predictions.

## Directory Structure

```
frontend/
├── index.html           # Main HTML entry point
├── js/                  # JavaScript code
│   ├── app.js           # Main application logic
│   ├── config.js        # Frontend configuration
│   ├── components/      # UI components
│   ├── services/        # Services for API communication
│   ├── state/           # State management
│   └── utils/           # Utility functions
│
└── styles/              # CSS styles
    ├── main.css         # Main stylesheet
    ├── components/      # Component-specific styles
    └── utils/           # CSS utility classes
```

## Features

- **Interactive Map Interface**: View and navigate satellite imagery
- **Project Management**: Create, select, and manage projects
- **Point Labeling**: Add positive and negative label points on the map
- **Data Extraction**: Extract satellite imagery data for labeled points
- **Data Visualization**: View extracted satellite data patches
- **Model Training**: Train machine learning models on labeled data
- **Model Deployment**: Deploy trained models to make predictions on new areas

## Setup and Installation

1. Ensure you have the backend server running (see the backend README)
2. Open `js/config.js` and update the API endpoints if needed
3. Serve the frontend files with a static file server of your choice:

   Using Python's built-in HTTP server:
   ```
   cd frontend
   python -m http.server 8000
   ```
   
   Using Node.js with http-server:
   ```
   npm install -g http-server
   cd frontend
   http-server -p 8000
   ```

4. Open a web browser and navigate to `http://localhost:8000`

## Configuration

The frontend configuration is stored in `js/config.js`. You may need to update:

- `API_URL`: The URL of the backend API
- `MAPBOX_TOKEN`: Your Mapbox access token for the map interface
- `DEFAULT_MAP_CENTER`: Default map center coordinates
- `DEFAULT_ZOOM`: Default zoom level

## Using the Application

### Navigation

The sidebar on the left contains tools for:
- Project management
- Point labeling
- Data extraction
- Data visualization
- Model training
- Model deployment

### Workflow

1. **Create or Select a Project**: Use the project selector to create a new project or select an existing one
2. **Label Points**: Use the point tool to add positive and negative examples on the map
3. **Extract Data**: Extract satellite imagery for the labeled points
4. **Visualize Data**: View the extracted satellite data patches
5. **Train Model**: Train a machine learning model using the extracted data
6. **Deploy Model**: Deploy the trained model to make predictions on new areas

## Communication with Backend

The frontend communicates with the backend through:
- RESTful API calls for data operations
- Socket.IO for real-time updates during extraction, training, and deployment

## Extending the Frontend

### Adding New Components

1. Create a new JavaScript file in the `js/components/` directory
2. Add corresponding styles in `styles/components/` if needed
3. Import and use the component in `app.js` or other components

### Adding New API Services

1. Create a new service file in the `js/services/` directory
2. Implement the necessary API calls
3. Import and use the service in components or other parts of the application

## Troubleshooting

### Common Issues

- **Map Not Loading**: Check your Mapbox token in `config.js`
- **API Connection Errors**: Ensure the backend server is running and the `API_URL` is correctly set
- **Socket.IO Connection Issues**: Verify that WebSocket connections are not blocked by firewalls
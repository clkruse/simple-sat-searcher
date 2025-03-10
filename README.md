# Simple Satellite Imagery Searcher

A comprehensive tool for satellite imagery processing, analysis, and model development. This application allows users to label points on satellite imagery, extract data from those points, train machine learning models, and deploy those models to search for similar features in new areas.

## Features

- **Interactive Map Interface**: Navigate and view satellite imagery
- **Point Labeling**: Mark positive and negative examples on the map
- **Data Extraction**: Extract satellite imagery from Google Earth Engine
- **Data Visualization**: View and analyze extracted data patches
- **Model Training**: Train machine learning models on labeled data
- **Model Deployment**: Deploy models to identify similar features in new areas

## Repository Structure

```
simple-sat-searcher/
├── frontend/                    # User interface
│   ├── index.html               # Main HTML entry point
│   ├── js/                      # JavaScript code
│   └── styles/                  # CSS styles
│
└── backend/                     # Server-side application
    ├── app.py                   # Application entry point
    ├── config.py                # Configuration settings
    ├── api/                     # API endpoints
    ├── models/                  # Model-related functionality
    ├── services/                # Services and utilities
    └── utils/                   # Utility functions
```

## Prerequisites

- Python 3.8 or higher
- Node.js and npm (for frontend development)
- Google Earth Engine account
- Mapbox account for map visualization

## Installation and Setup

### Backend Setup

1. Navigate to the backend directory:
   ```
   cd backend
   ```

2. Create a virtual environment:
   ```
   python -m venv venv
   ```

3. Activate the virtual environment:
   - On Windows: `venv\Scripts\activate`
   - On macOS/Linux: `source venv/bin/activate`

4. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

5. Configure Google Earth Engine authentication:
   ```
   earthengine authenticate
   ```

6. Update `config.py` with your settings

7. Start the backend server:
   ```
   python app.py
   ```

### Frontend Setup

1. Navigate to the frontend directory:
   ```
   cd frontend
   ```

2. Update `js/config.js` with your API endpoints and Mapbox token

3. Serve the frontend files with a static file server:
   
   Using Python's built-in HTTP server:
   ```
   python -m http.server 8000
   ```
   
   Using Node.js with http-server:
   ```
   npm install -g http-server
   http-server -p 8000
   ```

4. Open a web browser and navigate to `http://localhost:8000`

## Usage Workflow

1. **Create a Project**: Set up a new project to organize your data
2. **Label Points**: Add positive and negative examples on the map
3. **Extract Data**: Extract satellite imagery for the labeled points
4. **Visualize Data**: Review the extracted data patches
5. **Train Model**: Train a machine learning model using the extracted data
6. **Deploy Model**: Deploy the trained model to search for similar features in new areas

## Data Flow

```
User Input → Point Labeling → Data Extraction → Model Training → Model Deployment → Predictions
```

## Development

### Setting Up Development Environment

1. Clone the repository:
   ```
   git clone https://github.com/clkruse/simple-sat-searcher.git
   cd simple-sat-searcher
   ```

2. Follow the backend and frontend setup instructions above

3. For development mode with automatic reloading:
   - Backend: Use Flask's development server
   - Frontend: Modify files directly and refresh the browser

## Troubleshooting

### Common Issues and Solutions

- **Backend Connection Issues**: Ensure the backend server is running and accessible
- **Map Not Loading**: Verify your Mapbox token is valid
- **Earth Engine Authentication**: Make sure you're authenticated with Google Earth Engine
- **Data Extraction Failures**: Check your internet connection and Earth Engine quota
- **Training Errors**: Ensure you have enough labeled points and the model parameters are suitable

## Documentation

For more detailed information:
- [Frontend Documentation](frontend/README.md)
- [Backend Documentation](backend/README.md)
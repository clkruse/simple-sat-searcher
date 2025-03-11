// js/components/Map.js
import { EventEmitter } from '../utils/EventEmitter.js';
import { config } from '../config.js';
import { store } from '../state/Store.js';
import { ApiService } from '../services/ApiService.js';

class Map extends EventEmitter {
  constructor() {
    super();
    
    // Map state
    this.mapInstance = null;
    this.pointsSource = null;
    this.patchOverlays = [];
    this.patchLayers = [];
    this.patchSources = [];
    
    // Initialize on DOM load
    document.addEventListener('DOMContentLoaded', () => {
      this.initialize();
      this.setupStateListeners();
    });
  }
  
  initialize() {
    // Initialize Mapbox GL
    mapboxgl.accessToken = config.MAPBOX_ACCESS_TOKEN;
    
    this.mapInstance = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/satellite-v9', // Default to satellite view
      center: config.mapDefaults.center,
      zoom: config.mapDefaults.zoom,
      projection: config.mapDefaults.projection
    });
    
    // disable map rotation using right click + drag
    this.mapInstance.dragRotate.disable();

    // disable map rotation using touch rotation gesture
    this.mapInstance.touchZoomRotate.disableRotation();

    // Add error handling
    this.mapInstance.on('error', (e) => {
      console.error('Map error:', e.error);
    });
    
    // Add navigation controls
    this.mapInstance.addControl(new mapboxgl.NavigationControl({
      showCompass: false
    }), 'bottom-right');
    
    // Setup map layers when loaded
    this.mapInstance.on('load', () => {
      this.onMapLoad();
      // Set the current base layer
      this.currentBaseLayer = 'satellite';
    });
    
    // Setup interaction events
    this.setupEventListeners();
  }
  
  onMapLoad() {
    this.mapInstance.setFog({});
    // Add a source for points
    this.mapInstance.addSource('points', {
      'type': 'geojson',
      'data': {
        'type': 'FeatureCollection',
        'features': []
      }
    });
    
    this.pointsSource = this.mapInstance.getSource('points');
    
    // Add circle layer for positive points
    this.mapInstance.addLayer({
      'id': 'point-positive',
      'type': 'circle',
      'source': 'points',
      'filter': ['==', ['get', 'class'], 'positive'],
      'paint': {
        'circle-radius': 5,
        'circle-color': '#3a86ff',
        'circle-opacity': 0.9,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#fff'
      }
    });
    
    // Add circle layer for negative points
    this.mapInstance.addLayer({
      'id': 'point-negative',
      'type': 'circle',
      'source': 'points',
      'filter': ['==', ['get', 'class'], 'negative'],
      'paint': {
        'circle-radius': 5,
        'circle-color': '#ff3a5e',
        'circle-opacity': 0.9,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#fff'
      }
    });
    
    // Emit map loaded event
    this.emit('loaded');
  }
  
  setupEventListeners() {
    // Change cursor when hovering over points
    this.mapInstance.on('mouseenter', 'point-positive', () => {
      this.mapInstance.getCanvas().style.cursor = 'pointer';
    });
    
    this.mapInstance.on('mouseenter', 'point-negative', () => {
      this.mapInstance.getCanvas().style.cursor = 'pointer';
    });
    
    this.mapInstance.on('mouseleave', 'point-positive', () => {
      this.mapInstance.getCanvas().style.cursor = '';
    });
    
    this.mapInstance.on('mouseleave', 'point-negative', () => {
      this.mapInstance.getCanvas().style.cursor = '';
    });
    
    // Add point on click (left click for positive, right click for negative)
    this.mapInstance.on('click', (e) => {
      const currentProjectId = store.get('currentProjectId');
      if (!currentProjectId) {
        this.emit('projectRequired');
        return;
      }
      
      // Check if Clear Points mode is active
      const clearPointsActive = document.getElementById('clear-btn').classList.contains('active');
      
      if (clearPointsActive) {
        // In Clear Points mode, clicking on a point removes it
        const layers = ['point-positive', 'point-negative'].filter(layerId => 
          this.mapInstance.getLayer(layerId)
        );
        
        if (layers.length === 0) return;
        
        const features = this.mapInstance.queryRenderedFeatures(e.point, {
          layers: layers
        });
        
        // If a point was clicked, remove it
        if (features.length > 0) {
          const pointId = features[0].properties.id;
          this.removePoint(pointId);
        }
      } else {
        // Normal mode: left click adds a positive point
        this.addPoint(e.lngLat, 'positive');
      }
    });
    
    // Right click adds a negative point (when not in Clear Points mode)
    this.mapInstance.on('contextmenu', (e) => {
      const currentProjectId = store.get('currentProjectId');
      if (!currentProjectId) {
        return;
      }
      
      // Check if Clear Points mode is active
      const clearPointsActive = document.getElementById('clear-btn').classList.contains('active');
      
      if (!clearPointsActive) {
        // Add negative point on right click
        this.addPoint(e.lngLat, 'negative');
      }
      
      // Prevent the default context menu
      e.preventDefault();
    });
  }
  
  setupStateListeners() {
    // Listen for point changes
    store.on('points', points => {
      this.updatePointsOnMap(points);
    });
    
    // Listen for project selection to visualize patches
    store.on('currentProjectId', projectId => {
      if (projectId) {
        // Small delay to allow points to load first
        setTimeout(() => {
          this.visualizeAllPointPatches(projectId, true);
        }, 500);
      } else {
        // If project is deselected, clear visualizations
        this.clearVisualization();
      }
   });
    
    // Listen for visualization changes
    store.on('visualizationChanged', data => {
      this.displayPatches(data.patches, data.visualizationType);
    });
    
    // Listen for incremental deployment updates
    store.on('deploymentIncrementalUpdate', data => {
      this.updateDeploymentPredictions(data.predictions, data.boundingBox);
    });
    
    // Listen for deployment completion
    store.on('deploymentComplete', data => {
      this.displayDeploymentPredictions(data.predictions, data.boundingBox);
    });
    
    // Listen for prediction loaded
    store.on('predictionLoaded', data => {
      this.displayDeploymentPredictions(data.prediction, data.boundingBox);
    });
  }
  
  addPoint(lngLat, pointClass) {
    const pointId = Date.now();
    
    // Get the imagery time period and cloudiness threshold from the control panel
    // or map imagery panel, depending on which is available
    let startDate = '';
    let endDate = '';
    let clearThreshold = 0.75;
    
    // Try to get values from control panel first (highest priority)
    const controlStartDate = document.getElementById('control-start-date');
    const controlEndDate = document.getElementById('control-end-date');
    const controlThreshold = document.getElementById('control-clear-threshold');
    
    if (controlStartDate && controlEndDate && controlThreshold) {
      startDate = controlStartDate.value;
      endDate = controlEndDate.value;
      clearThreshold = controlThreshold.value;
    } else {
      // Fall back to map imagery panel values if available
      const imageryStartDate = document.getElementById('imagery-start-date');
      const imageryEndDate = document.getElementById('imagery-end-date');
      const imageryThreshold = document.getElementById('imagery-clear-threshold');
      
      if (imageryStartDate && imageryEndDate && imageryThreshold) {
        startDate = imageryStartDate.value;
        endDate = imageryEndDate.value;
        clearThreshold = imageryThreshold.value;
      } else {
        // Last resort: try extract panel values
        const extractStartDate = document.getElementById('start-date');
        const extractEndDate = document.getElementById('end-date');
        const extractThreshold = document.getElementById('clear-threshold');
        
        if (extractStartDate && extractEndDate && extractThreshold) {
          startDate = extractStartDate.value;
          endDate = extractEndDate.value;
          clearThreshold = extractThreshold.value;
        }
      }
    }
    
    // Create a new point feature
    const point = {
      'type': 'Feature',
      'geometry': {
        'type': 'Point',
        'coordinates': [lngLat.lng, lngLat.lat]
      },
      'properties': {
        'id': pointId,
        'class': pointClass,
        'start_date': startDate,
        'end_date': endDate,
        'clear_threshold': clearThreshold
      }
    };
    
    // Add to store
    store.addPoint(point);
    
    // Ensure the points source and layers exist (especially important when using custom base layers)
    this._ensurePointLayersExist();
    
    // Immediately update the points on the map
    this.updatePointsOnMap(store.get('points'));
    
    // Emit event for other components
    this.emit('pointAdded', point);
    
    // Auto-export points
    if (store.get('currentProjectId')) {
      store.exportPoints().then(() => {
        // After exporting points, trigger extraction for this point
        this.extractPointData(point);
      });
    }
  }
  
  // Helper method to ensure point layers exist
  _ensurePointLayersExist() {
    const pointsData = store.get('points') || [];
    
    // Check if points source exists
    if (!this.mapInstance.getSource('points')) {
      // Add the points source
      this.mapInstance.addSource('points', {
        'type': 'geojson',
        'data': {
          'type': 'FeatureCollection',
          'features': pointsData
        }
      });
      
      this.pointsSource = this.mapInstance.getSource('points');
    }
    
    // Check if point layers exist
    const hasPositiveLayer = this.mapInstance.getLayer('point-positive');
    const hasNegativeLayer = this.mapInstance.getLayer('point-negative');
    
    // If either layer doesn't exist, create both to ensure proper ordering
    if (!hasPositiveLayer || !hasNegativeLayer) {
      // Remove existing layers if they exist (to recreate them in the right order)
      if (hasPositiveLayer) {
        this.mapInstance.removeLayer('point-positive');
      }
      if (hasNegativeLayer) {
        this.mapInstance.removeLayer('point-negative');
      }
      
      // Add circle layer for positive points
      this.mapInstance.addLayer({
        'id': 'point-positive',
        'type': 'circle',
        'source': 'points',
        'filter': ['==', ['get', 'class'], 'positive'],
        'paint': {
          'circle-radius': 5,
          'circle-color': '#3a86ff',
          'circle-opacity': 0.9,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff'
        }
      });
      
      // Add circle layer for negative points
      this.mapInstance.addLayer({
        'id': 'point-negative',
        'type': 'circle',
        'source': 'points',
        'filter': ['==', ['get', 'class'], 'negative'],
        'paint': {
          'circle-radius': 5,
          'circle-color': '#ff3a5e',
          'circle-opacity': 0.9,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff'
        }
      });
    } else {
      // Ensure the point layers are at the top of the layer stack
      this.mapInstance.moveLayer('point-positive');
      this.mapInstance.moveLayer('point-negative');
    }
  }
  
  // Extract data for a single point
  extractPointData(point) {
    const currentProjectId = store.get('currentProjectId');
    if (!currentProjectId) return;
    
    // Get project info to find out chip size
    const apiService = new ApiService();
    
    apiService.getProjectInfo(currentProjectId)
      .then(response => {
        // Fix: Access chip_size from the project field in the response
        const projectInfo = response.project;
        const chipSize = projectInfo.chip_size || 64; // Default to 64 if not found
        
        // Get collection from control panel if available
        let collection = 'S2';
        const controlCollection = document.getElementById('control-collection');
        if (controlCollection) {
          collection = controlCollection.value;
        }
        
        // Extract data for this point
        return apiService.extractPointData({
          project_id: currentProjectId,
          point: point,
          collection: collection,
          chip_size: chipSize
        });
      })
      .then(response => {
        if (response.success) {
          console.log(`Data extracted for point ${point.properties.id}`);
          
          // Now visualize only this point without clearing existing visualizations
          this.visualizeSinglePoint(currentProjectId, point.properties.id);
        } else {
          console.error(`Error extracting data for point: ${response.message}`);
        }
      })
      .catch(error => {
        console.error(`Error during point extraction: ${error.message}`);
      });
  }
  
  // Visualize only a single point's patch without clearing existing visualizations
  visualizeSinglePoint(projectId, pointId) {
    const apiService = new ApiService();
    
    // Default visualization type - true_color is usually a good default
    const visualizationType = 'true_color';
    
    // First, list extractions to find the most recent file
    apiService.listExtractedData(projectId)
      .then(data => {
        if (!data.success || !data.extractions || data.extractions.length === 0) {
          throw new Error('No extractions found for this project');
        }
        
        // Get the most recent extraction
        const latestExtraction = data.extractions[0].filename;
        
        // Get visualization for just this point
        return apiService.getPatchVisualization(
          projectId,
          latestExtraction,
          visualizationType,
          pointId // Pass the point ID to get just this one patch
        );
      })
      .then(data => {
        if (data.success && data.patches && data.patches.length > 0) {
          // Display just this patch without clearing others
          this.displayPatches(data.patches, visualizationType, false);
        } else {
          console.warn('No visualization data available for this point yet');
        }
      })
      .catch(error => {
        console.error(`Error visualizing point: ${error.message}`);
      });
  }
  
  // Visualize patches for all extracted points in the project
  visualizeAllPointPatches(projectId, clearExisting = true) {
    const apiService = new ApiService();
    
    // Default visualization type - true_color is usually a good default
    const visualizationType = 'true_color';
    
    // First, list extractions to find the most recent file
    apiService.listExtractedData(projectId)
      .then(data => {
        if (!data.success || !data.extractions || data.extractions.length === 0) {
          throw new Error('No extractions found for this project');
        }
        
        // Get the most recent extraction
        const latestExtraction = data.extractions[0].filename;
        
        // Get visualization for all points
        return apiService.getPatchVisualization(
          projectId,
          latestExtraction,
          visualizationType
          // No point_id parameter means we get all points
        );
      })
      .then(data => {
        if (data.success && data.patches && data.patches.length > 0) {
          // Display all patches, optionally clearing existing ones
          this.displayPatches(data.patches, visualizationType, clearExisting);
        } else {
          console.warn('No visualization data available for this project yet');
        }
      })
      .catch(error => {
        console.error(`Error visualizing patches: ${error.message}`);
      });
  }

  removePoint(pointId) {
    // Find the point in the store
    const points = store.get('points');
    const point = points.find(p => p.properties.id === pointId);
    const pointClass = point ? point.properties.class : '';
    
    // Remove from store
    store.removePoint(pointId);
    
    // Ensure the points source and layers exist
    this._ensurePointLayersExist();
    
    // Immediately update the points on the map
    this.updatePointsOnMap(store.get('points'));
    
    // Emit event for other components
    this.emit('pointRemoved', { id: pointId, class: pointClass });
    
    // Auto-export points
    const currentProjectId = store.get('currentProjectId');
    if (currentProjectId) {
      store.exportPoints().then(() => {
        // After removing a point, we need to reload all visualizations
        // This is necessary because we don't have a direct way to identify 
        // which visualization belongs to which point
        this.visualizeAllPointPatches(currentProjectId, true);
      });
    }
  }
  
  updatePointsOnMap(points) {
    if (this.pointsSource) {
      this.pointsSource.setData({
        'type': 'FeatureCollection',
        'features': points
      });
    }
  }
  
  fitToPoints(points) {
    if (!points || points.length === 0) return;
    
    const bounds = new mapboxgl.LngLatBounds();
    
    points.forEach(point => {
      const coordinates = point.geometry.coordinates;
      bounds.extend([coordinates[0], coordinates[1]]);
    });
    
    this.mapInstance.fitBounds(bounds, {
      padding: 100,
      maxZoom: 15
    });
  }
  
  // Clear all visualization overlays (patches, etc.)
  clearVisualization() {
    // Clear markers
    this.patchOverlays.forEach(marker => marker.remove());
    this.patchOverlays = [];
    
    // Remove layers
    this.patchLayers.forEach(layerId => {
      if (this.mapInstance.getLayer(layerId)) {
        this.mapInstance.removeLayer(layerId);
      }
    });
    this.patchLayers = [];
    
    // Remove sources
    this.patchSources.forEach(sourceId => {
      if (this.mapInstance.getSource(sourceId)) {
        this.mapInstance.removeSource(sourceId);
      }
    });
    this.patchSources = [];
  }
  
  // Display patches on the map with geographic scaling
  displayPatches(patches, visualizationType, clearExisting = true) {
    // Clear any existing overlays if requested
    if (clearExisting) {
      this.clearVisualization();
    }
    
    patches.forEach((patch, index) => {
      // Get coordinates
      const lon = patch.longitude;
      const lat = patch.latitude;
      
      // Create a unique ID for this patch
      const patchId = `patch-${Date.now()}-${index}`;
      const sourceId = `source-${patchId}`;
      const layerId = `layer-${patchId}`;
      
      // Calculate the geographic bounds of the patch
      // For Sentinel-2, each pixel is approximately 10m x 10m
      const pixelSize = 10; // meters
      const chipSizeMeters = patch.chip_size * pixelSize;
      const offsetMeters = chipSizeMeters / 2;
      
      // Calculate bounding coordinates (approximate)
      // Convert meters to approximate degrees at this latitude
      // 111,320 meters = 1 degree of latitude
      // 111,320 * cos(latitude) meters = 1 degree of longitude
      const metersPerDegreeLat = 111320;
      const metersPerDegreeLon = 111320 * Math.cos(lat * Math.PI / 180);
      
      const offsetLat = offsetMeters / metersPerDegreeLat;
      const offsetLon = offsetMeters / metersPerDegreeLon;
      
      const bounds = [
        [lon - offsetLon, lat - offsetLat], // Southwest corner
        [lon + offsetLon, lat + offsetLat]  // Northeast corner
      ];
      
      // Add the image as a raster source to the map
      this.mapInstance.addSource(sourceId, {
        'type': 'image',
        'url': `data:image/png;base64,${patch.image}`,
        'coordinates': [
          [bounds[0][0], bounds[1][1]], // Top left (NW)
          [bounds[1][0], bounds[1][1]], // Top right (NE)
          [bounds[1][0], bounds[0][1]], // Bottom right (SE)
          [bounds[0][0], bounds[0][1]]  // Bottom left (SW)
        ]
      });
      this.patchSources.push(sourceId);
      
      // Add the image as a raster layer
      this.mapInstance.addLayer({
        'id': layerId,
        'type': 'raster',
        'source': sourceId,
        'paint': {
          'raster-opacity': 1.0,
          'raster-fade-duration': 0
        },
        'layout': {
          'visibility': 'visible'
        }
      });
      this.patchLayers.push(layerId);
      
      // Add a small marker at the center point to show the label (positive/negative)
      const el = document.createElement('div');
      el.className = `patch-marker patch-${patch.label}`;
      
      // Create the marker
      const marker = new mapboxgl.Marker({
        element: el,
        anchor: 'center'
      }).setLngLat([lon, lat]).addTo(this.mapInstance);
      
      this.patchOverlays.push(marker);
    });
    
    // Ensure point layers are on top after adding patches
    this._ensurePointLayersExist();
    
    // Make sure the points are visible by updating them again
    this.updatePointsOnMap(store.get('points'));
  }
  
  // Handle incremental deployment predictions
  updateDeploymentPredictions(predictions, boundingBox) {
    // Check if predictions is valid
    if (!predictions || !predictions.features) {
      console.error('Invalid predictions data:', predictions);
      return;
    }
    
    // Initialize the predictions source if it doesn't exist yet
    if (!this.mapInstance.getSource('deployment-predictions')) {
      // Add the bounding box if provided and not already added
      if (boundingBox && !this.mapInstance.getSource('deployment-bbox')) {
        this.mapInstance.addSource('deployment-bbox', {
          type: 'geojson',
          data: boundingBox
        });
        
        this.mapInstance.addLayer({
          id: 'deployment-bbox',
          type: 'line',
          source: 'deployment-bbox',
          paint: {
            'line-color': '#27ae60',
            'line-width': 2,
            'line-dasharray': [2, 1]
          }
        });
        
        // Fit the map to the bounding box
        try {
          const bounds = new mapboxgl.LngLatBounds();
          
          if (boundingBox.geometry && boundingBox.geometry.coordinates && boundingBox.geometry.coordinates[0]) {
            boundingBox.geometry.coordinates[0].forEach(coord => {
              bounds.extend(coord);
            });
          }
          
          if (!bounds.isEmpty()) {
            this.mapInstance.fitBounds(bounds, {
              padding: 50,
              maxZoom: 16
            });
          }
        } catch (error) {
          console.error('Error fitting bounds to bounding box', error);
        }
      }
      
      // Add an empty predictions source
      this.mapInstance.addSource('deployment-predictions', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      });
      
      // Add the predictions line layer
      this.mapInstance.addLayer({
        id: 'deployment-predictions-line',
        type: 'line',
        source: 'deployment-predictions',
        paint: {
          'line-color': '#FF6F00',
          'line-width': 2,
          'line-opacity': [
            'get', 'confidence'  // Use the confidence property directly for opacity
          ]
        }
      });
    }
    
    // Get the current predictions data
    const source = this.mapInstance.getSource('deployment-predictions');
    if (!source) {
      console.error('Deployment predictions source not found');
      return;
    }
    
    const currentData = source._data || { type: 'FeatureCollection', features: [] };
    
    // Add the new predictions to the existing ones
    const updatedFeatures = [...currentData.features, ...predictions.features];
    
    // Update the source data, preserving metadata properties
    source.setData({
      type: 'FeatureCollection',
      features: updatedFeatures,
      properties: predictions.properties || currentData.properties
    });
  }
  
  // Display deployment predictions on the map
  displayDeploymentPredictions(predictions, boundingBox) {
    if (!predictions || typeof predictions !== 'object') {
      console.error('Invalid predictions data received', predictions);
      return;
    }
    
    // Remove any existing prediction layers and sources
    if (this.mapInstance.getLayer('deployment-predictions-line')) {
      this.mapInstance.removeLayer('deployment-predictions-line');
    }
    if (this.mapInstance.getSource('deployment-predictions')) {
      this.mapInstance.removeSource('deployment-predictions');
    }
    
    // Remove any existing bounding box
    if (this.mapInstance.getLayer('deployment-bbox')) {
      this.mapInstance.removeLayer('deployment-bbox');
    }
    if (this.mapInstance.getSource('deployment-bbox')) {
      this.mapInstance.removeSource('deployment-bbox');
    }
    
    // Always add the bounding box if provided, even if there are no predictions
    if (boundingBox && boundingBox.geometry) {
      this.mapInstance.addSource('deployment-bbox', {
        type: 'geojson',
        data: boundingBox
      });
      
      this.mapInstance.addLayer({
        id: 'deployment-bbox',
        type: 'line',
        source: 'deployment-bbox',
        paint: {
          'line-color': '#27ae60',
          'line-width': 2,
          'line-dasharray': [2, 1]
        }
      });
    }
    
    // Add predictions to the map if there are any features
    if (predictions.features && predictions.features.length > 0) {
      // Add the predictions as a source
      this.mapInstance.addSource('deployment-predictions', {
        type: 'geojson',
        data: predictions
      });
      
      // Add an outline layer to display the bounding boxes with opacity based on confidence
      this.mapInstance.addLayer({
        id: 'deployment-predictions-line',
        type: 'line',
        source: 'deployment-predictions',
        paint: {
          'line-color': '#FFCE00',
          'line-width': 2,
          'line-opacity': ['get', 'confidence'] // Use the confidence property directly for opacity
          //'line-opacity': 1.0
        }
      });
      
    }
  }
  
  // Cleanup map imagery
  cleanupMapImagery() {
    // Simply revert to default satellite layer
    this.setBaseLayer('satellite');
    return Promise.resolve();
  }
  
  // Method to manage base layers
  setBaseLayer(layerType, options = {}) {
    // Default to 'satellite' if no type specified
    layerType = layerType || 'satellite';
    
    // 1. First, remove any existing GEE custom imagery layer
    if (this.mapInstance.getLayer('gee-imagery')) {
      this.mapInstance.removeLayer('gee-imagery');
    }
    if (this.mapInstance.getSource('gee-imagery')) {
      this.mapInstance.removeSource('gee-imagery');
    }
    
    // 2. Handle the different base layer types
    if (layerType === 'satellite') {
      // Switch to the Mapbox satellite style
      this.changeMapStyle('mapbox://styles/mapbox/satellite-v9', true);
      this.currentBaseLayer = 'satellite';
      return Promise.resolve();
    } 
    else if (layerType === 'custom' && options.tileUrl) {
      // Validate the tile URL
      if (!options.tileUrl || typeof options.tileUrl !== 'string') {
        return Promise.reject(new Error("Invalid tile URL"));
      }
      
      // Add the GEE custom imagery as a source
      return new Promise((resolve, reject) => {
        try {
          // Use a completely empty style for custom imagery to avoid any vector layers on top
          const emptyStyle = {
            version: 8,
            name: "Empty",
            metadata: {},
            sources: {},
            layers: [],
            id: "empty-style"
          };
          
          // Apply the empty style
          this.changeMapStyle(emptyStyle, true);
          
          // Wait for the style to fully load
          this.mapInstance.once('style.load', () => {
            // Add after a slight delay to ensure the map is ready
            setTimeout(() => {
              try {
                this._addCustomBaseLayer(options);
                this.currentBaseLayer = 'custom';
                resolve();
              } catch (error) {
                // If we fail to add the custom layer, revert to satellite
                this.changeMapStyle('mapbox://styles/mapbox/satellite-v9', true);
                this.currentBaseLayer = 'satellite';
                reject(error);
              }
            }, 100);
          });
        } catch (error) {
          // If we fail, revert to satellite
          this.changeMapStyle('mapbox://styles/mapbox/satellite-v9', true);
          this.currentBaseLayer = 'satellite';
          reject(error);
        }
      });
    }
    
    // Default case, resolve with no action
    return Promise.resolve();
  }
  
  _addCustomBaseLayer(options) {
    try {
      // Format the tile URL correctly for mapbox
      let tileUrl = options.tileUrl;
      
      // Ensure the URL is in the correct format for Mapbox GL JS
      // Sometimes the GEE API returns URLs with {x}, {y}, {z} placeholders
      // but Mapbox GL JS expects {z}/{x}/{y}
      if (tileUrl && (tileUrl.includes('{x}') || tileUrl.includes('{y}') || tileUrl.includes('{z}'))) {
        // Only reformat if it's not already in the right format
        if (!tileUrl.includes('{z}/{x}/{y}')) {
          // Extract the URL without the placeholders
          let baseUrl = tileUrl;
          baseUrl = baseUrl.replace('{x}', '{0}').replace('{y}', '{1}').replace('{z}', '{2}');
          baseUrl = baseUrl.replace('{0}', '{x}').replace('{1}', '{y}').replace('{2}', '{z}');
          tileUrl = baseUrl;
        }
      }
      
      // Add the raster tiles as a source
      this.mapInstance.addSource('gee-imagery', {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        attribution: options.attribution || 'Google Earth Engine'
      });
      
      // With an empty style, we can just add the layer without specifying a layer to insert before
      const layerConfig = {
        id: 'gee-imagery',
        type: 'raster',
        source: 'gee-imagery',
        paint: {
          'raster-opacity': 1.0  // Full opacity to make sure imagery is visible
        }
      };
      
      this.mapInstance.addLayer(layerConfig);
      
      // Store the current imagery info
      this.currentImagery = {
        collection: options.collection,
        startDate: options.startDate,
        endDate: options.endDate,
        bounds: options.bounds
      };
      
      // Zoom to the imagery bounds if provided
      if (options.bounds && options.fitBounds !== false) {
        this.mapInstance.fitBounds(options.bounds, { padding: 0 });
      }
    } catch (error) {
      throw error;
    }
  }
  
  // Restore deployment predictions from saved data
  restoreDeploymentPredictions() {
    if (!this.savedDeploymentData) {
      return;
    }
    
    // Restore deployment bbox if it exists
    if (this.savedDeploymentData.bbox) {
      this.mapInstance.addSource('deployment-bbox', {
        type: 'geojson',
        data: this.savedDeploymentData.bbox
      });
      
      this.mapInstance.addLayer({
        id: 'deployment-bbox',
        type: 'line',
        source: 'deployment-bbox',
        paint: {
          'line-color': '#27ae60',
          'line-width': 2,
          'line-dasharray': [2, 1]
        }
      });
    }
    
    // Restore deployment predictions if they exist
    if (this.savedDeploymentData.predictions && 
        this.savedDeploymentData.predictions.features && 
        this.savedDeploymentData.predictions.features.length > 0) {
      
      this.mapInstance.addSource('deployment-predictions', {
        type: 'geojson',
        data: this.savedDeploymentData.predictions
      });
      
      this.mapInstance.addLayer({
        id: 'deployment-predictions-line',
        type: 'line',
        source: 'deployment-predictions',
        paint: {
          'line-color': '#FF6F00',
          'line-width': 2,
          'line-opacity': [
            'get', 'confidence'  // Use the confidence property directly for opacity
          ]
        }
      });
    }
  }
  
  // Simple method to set map style
  setStyle(styleUrl) {
    this.mapInstance.setStyle(styleUrl);
  }
  
  // Change map style with data preservation
  changeMapStyle(styleUrl, preserveData = true) {
    // If we need to preserve data, save the current points and other data
    if (preserveData) {
      const pointsData = store.get('points');
      
      // Check for prediction layers and save their data
      let predictionData = null;
      let deploymentPredictionData = null;
      let deploymentBboxData = null;
      let hasPredictions = false;
      let hasDeploymentPredictions = false;
      let hasDeploymentBbox = false;
      
      // Save patch visualizations
      const patchSources = [];
      const patchLayers = [];
      
      try {
        // Check for regular predictions
        if (this.mapInstance.getSource('predictions')) {
          predictionData = this.mapInstance.getSource('predictions')._data;
          hasPredictions = true;
        }
        
        // Check for deployment predictions
        if (this.mapInstance.getSource('deployment-predictions')) {
          deploymentPredictionData = this.mapInstance.getSource('deployment-predictions')._data;
          hasDeploymentPredictions = true;
        }
        
        // Check for deployment bounding box
        if (this.mapInstance.getSource('deployment-bbox')) {
          deploymentBboxData = this.mapInstance.getSource('deployment-bbox')._data;
          hasDeploymentBbox = true;
        }
        
        // Save all patch visualizations
        // Find all sources that start with 'source-patch-'
        const style = this.mapInstance.getStyle();
        if (style && style.sources) {
          Object.keys(style.sources).forEach(sourceId => {
            if (sourceId.startsWith('source-patch-')) {
              const source = style.sources[sourceId];
              if (source.type === 'image' && source.url) {
                patchSources.push({
                  id: sourceId,
                  url: source.url,
                  coordinates: source.coordinates
                });
              }
            }
          });
        }
        
        // Save all layers related to patches
        if (style && style.layers) {
          style.layers.forEach(layer => {
            if (layer.id.startsWith('layer-patch-')) {
              patchLayers.push({
                id: layer.id,
                sourceId: layer.source,
                // Don't store minzoom/maxzoom as we'll use defaults later
                type: layer.type,
                paint: layer.paint || {}
              });
            }
          });
        }
      } catch (error) {
        // Silent error - we'll continue with what we have
      }
      
      // Listen for the style data event to restore data
      this.mapInstance.once('style.load', () => {
        try {
          // First, fix all the basic sources and layers
          // Re-add the points source and layers
          if (this.pointsSource && pointsData) {
            this.mapInstance.addSource('points', {
              'type': 'geojson',
              'data': {
                'type': 'FeatureCollection',
                'features': pointsData || []
              }
            });
            
            this.pointsSource = this.mapInstance.getSource('points');
            
            // Add circle layer for positive points
            this.mapInstance.addLayer({
              'id': 'point-positive',
              'type': 'circle',
              'source': 'points',
              'filter': ['==', ['get', 'class'], 'positive'],
              'paint': {
                'circle-radius': 5,
                'circle-color': '#3a86ff',
                'circle-opacity': 0.9,
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#fff'
              }
            });
            
            // Add circle layer for negative points
            this.mapInstance.addLayer({
              'id': 'point-negative',
              'type': 'circle',
              'source': 'points',
              'filter': ['==', ['get', 'class'], 'negative'],
              'paint': {
                'circle-radius': 5,
                'circle-color': '#ff3a5e',
                'circle-opacity': 0.9,
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#fff'
              }
            });
          }
          
          // Re-add predictions if they exist
          if (hasPredictions && predictionData) {
            this.mapInstance.addSource('predictions', {
              'type': 'geojson',
              'data': predictionData
            });
            
            this.mapInstance.addLayer({
              'id': 'predictions-line',
              'type': 'line',
              'source': 'predictions',
              'paint': {
                'line-color': [
                  'case',
                  ['==', ['get', 'class'], 'positive'], '#3a86ff',
                  ['==', ['get', 'class'], 'negative'], '#ff3a5e',
                  '#aaaaaa'
                ],
                'line-width': 2,
                'line-opacity': 0.8
              }
            });
          }
          
          // Re-add deployment predictions if they exist
          if (hasDeploymentPredictions && deploymentPredictionData) {
            this.mapInstance.addSource('deployment-predictions', {
              'type': 'geojson',
              'data': deploymentPredictionData
            });
            
            this.mapInstance.addLayer({
              'id': 'deployment-predictions-line',
              'type': 'line',
              'source': 'deployment-predictions',
              'paint': {
                'line-color': [
                  'case',
                  ['>=', ['get', 'probability'], 0.75], '#3a86ff',
                  ['>=', ['get', 'probability'], 0.5], '#63a4ff',
                  ['>=', ['get', 'probability'], 0.25], '#a9d2ff',
                  '#eeeeee'
                ],
                'line-width': 2,
                'line-opacity': 0.8
              }
            });
          }
          
          // Re-add deployment bbox if it exists
          if (hasDeploymentBbox && deploymentBboxData) {
            this.mapInstance.addSource('deployment-bbox', {
              'type': 'geojson',
              'data': deploymentBboxData
            });
            
            this.mapInstance.addLayer({
              'id': 'deployment-bbox',
              'type': 'line',
              'source': 'deployment-bbox',
              'paint': {
                'line-color': '#ffaa00',
                'line-width': 2,
                'line-opacity': 0.8
              }
            });
          }
          
          // Re-add all patch sources and layers
          for (const source of patchSources) {
            try {
              if (!this.mapInstance.getSource(source.id)) {
                this.mapInstance.addSource(source.id, {
                  'type': 'image',
                  'url': source.url,
                  'coordinates': source.coordinates
                });
              }
            } catch (err) {
              // Silent error
            }
          }
          
          // Improved layer restoration with validation
          for (const layer of patchLayers) {
            try {
              if (this.mapInstance.getSource(layer.sourceId) && !this.mapInstance.getLayer(layer.id)) {
                // Create a valid layer configuration
                const layerConfig = this._validateLayerConfig({
                  'id': layer.id,
                  'type': layer.type || 'raster',
                  'source': layer.sourceId,
                  'paint': {
                    'raster-opacity': 0.8
                  }
                });
                
                if (layerConfig) {
                  this.mapInstance.addLayer(layerConfig);
                }
              }
            } catch (err) {
              // Silent error
            }
          }
          
          // Emit a custom event to let other components know they can add layers
          this.emit('styleLoaded');
          
          // Also emit the native styledata event for consistency
          setTimeout(() => {
            this.mapInstance.fire('styledata');
          }, 50);
        } catch (error) {
          // Silent error
        }
      });
    }
    
    // Update map style
    this.mapInstance.setStyle(styleUrl);
  }
  
  // Validate a layer configuration to ensure it has all required properties
  _validateLayerConfig(layerConfig) {
    // Make a copy of the config to avoid modifying the original
    const config = { ...layerConfig };
    
    // Ensure required properties exist
    if (!config.id) {
      console.warn('Layer missing ID, skipping');
      return null;
    }
    
    if (!config.type) {
      console.warn(`Layer ${config.id} missing type, defaulting to 'raster'`);
      config.type = 'raster';
    }
    
    if (!config.source) {
      console.warn(`Layer ${config.id} missing source, skipping`);
      return null;
    }
    
    // Ensure paint is defined
    if (!config.paint) {
      config.paint = {};
    }
    
    // For raster layers, ensure raster-opacity is defined
    if (config.type === 'raster' && !config.paint['raster-opacity']) {
      config.paint['raster-opacity'] = 0.8;
    }
    
    // Remove any undefined properties that could cause validation errors
    Object.keys(config).forEach(key => {
      if (config[key] === undefined) {
        delete config[key];
      }
    });
    
    return config;
  }

  /**
   * Center the map at a specific location with animation
   * @param {Object} location - Location object with lat and lng properties
   * @param {number} zoom - Optional zoom level (defaults to 12)
   */
  centerAtLocation(location, zoom = 12) {
    if (!location || !location.lat || !location.lng) {
      console.warn('Invalid location provided to centerAtLocation');
      return;
    }
    
    // Fly to the location with animation
    this.mapInstance.flyTo({
      center: [location.lng, location.lat],
      zoom: zoom,
      essential: true, // This animation is considered essential for the user experience
      duration: 1500 // Animation duration in milliseconds
    });
  }
}

// Create a singleton instance
const map = new Map();

export { map };
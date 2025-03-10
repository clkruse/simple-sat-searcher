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
      style: config.mapDefaults.style,
      center: config.mapDefaults.center,
      zoom: config.mapDefaults.zoom
    });
    
    // Add navigation controls
    this.mapInstance.addControl(new mapboxgl.NavigationControl({
      showCompass: false
    }), 'bottom-right');
    
    // Setup map layers when loaded
    this.mapInstance.on('load', () => this.onMapLoad());
    
    // Setup interaction events
    this.setupEventListeners();
  }
  
  onMapLoad() {
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
    // Update map when points change
    store.on('points', (points) => {
      this.updatePointsOnMap(points);
    });
    
    // Auto-fit map when points are loaded
    store.on('points:loaded', (points) => {
      if (points && points.length > 0) {
        this.fitToPoints(points);
        
        // Visualize patches for all loaded points
        const currentProjectId = store.get('currentProjectId');
        if (currentProjectId) {
          this.visualizeAllPointPatches(currentProjectId, true);
        }
      }
    });
    
    // Listen for project selection to visualize patches
    store.on('currentProjectId', (projectId) => {
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
    
    // Handle deployment updates
    store.on('deploymentIncrementalUpdate', (data) => {
      if (data.predictions) {
        this.updateDeploymentPredictions(data.predictions, data.boundingBox);
      }
    });
    
    store.on('deploymentComplete', (data) => {
      if (data.predictions) {
        this.displayDeploymentPredictions(data.predictions, data.boundingBox);
      }
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
  
  // Extract data for a single point
  extractPointData(point) {
    const currentProjectId = store.get('currentProjectId');
    if (!currentProjectId) return;
    
    // Get project info to find out chip size
    const apiService = new ApiService();
    
    // Discreetly show a small indicator next to the point
    this.showExtractionIndicator(point);
    
    apiService.getProjectInfo(currentProjectId)
      .then(projectInfo => {
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
          // Update the indicator to show success
          this.updateExtractionIndicator(point, 'success');
          
          // Now visualize only this point without clearing existing visualizations
          this.visualizeSinglePoint(currentProjectId, point.properties.id);
        } else {
          console.error(`Error extracting data for point: ${response.message}`);
          // Update the indicator to show failure
          this.updateExtractionIndicator(point, 'error');
        }
      })
      .catch(error => {
        console.error(`Error during point extraction: ${error.message}`);
        this.updateExtractionIndicator(point, 'error');
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
  
  // Show a small indicator next to the point to show extraction status
  showExtractionIndicator(point) {
    // You can implement this to show a loading indicator
    // For simplicity, we'll just leave as a placeholder
    console.log(`Extracting data for point ${point.properties.id}...`);
  }
  
  // Update extraction indicator status
  updateExtractionIndicator(point, status) {
    // Update the indicator (placeholder)
    console.log(`Extraction for point ${point.properties.id} status: ${status}`);
  }
  
  removePoint(pointId) {
    // Get point class for the notification
    const point = store.get('points').find(p => p.properties.id === pointId);
    const pointClass = point ? point.properties.class : '';
    
    // Remove from store
    store.removePoint(pointId);
    
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
      })
      .setLngLat([lon, lat])
      .addTo(this.mapInstance);
      
      // Add popup with metadata
      const popup = new mapboxgl.Popup({
        closeButton: false,
        maxWidth: '200px'
      })
      .setHTML(`
        <div class="patch-popup">
          <img src="data:image/png;base64,${patch.image}" class="patch-popup-image" style="width: 100px;">
          <div class="patch-popup-info">
            <span class="patch-popup-label">Class: ${patch.label}</span>
            <span class="patch-popup-coords">
              ${lat.toFixed(6)}, ${lon.toFixed(6)}
            </span>
          </div>
          <div class="patch-popup-meta">
            <span>Coverage: ~${chipSizeMeters}m × ${chipSizeMeters}m</span>
          </div>
        </div>
      `);
      
      // Show popup on hover
      el.addEventListener('mouseenter', () => {
        marker.setPopup(popup);
        popup.addTo(this.mapInstance);
      });
      
      el.addEventListener('mouseleave', () => {
        popup.remove();
      });
      
      // Track the marker for later removal
      this.patchOverlays.push(marker);
    });
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
    
    // Update the source data
    source.setData({
      type: 'FeatureCollection',
      features: updatedFeatures
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
      
      // Fit the map to the bounding box
      try {
        const bounds = new mapboxgl.LngLatBounds();
        
        if (boundingBox.geometry.coordinates && boundingBox.geometry.coordinates[0]) {
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
          'line-color': '#FF6F00',
          'line-width': 2,
          'line-opacity': [
            'get', 'confidence'  // Use the confidence property directly for opacity
          ]
        }
      });
      
      // Fit the map to the predictions if we didn't already fit to the bounding box
      if (!boundingBox || !boundingBox.geometry) {
        try {
          const bounds = new mapboxgl.LngLatBounds();
          predictions.features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates) {
              // Handle different geometry types
              if (feature.geometry.type === 'Polygon') {
                feature.geometry.coordinates[0].forEach(coord => {
                  bounds.extend(coord);
                });
              } else if (feature.geometry.type === 'LineString') {
                feature.geometry.coordinates.forEach(coord => {
                  bounds.extend(coord);
                });
              } else if (feature.geometry.type === 'Point') {
                bounds.extend(feature.geometry.coordinates);
              }
            }
          });
          
          if (!bounds.isEmpty()) {
            this.mapInstance.fitBounds(bounds, {
              padding: 50,
              maxZoom: 16
            });
          }
        } catch (error) {
          console.error('Error fitting bounds to predictions', error);
        }
      }
    }
  }
  
  // Cleanup map imagery
  cleanupMapImagery() {
    try {
      // Only clean up the tile layer approach now
      if (this.mapInstance.getLayer('sentinel-imagery')) {
        this.mapInstance.removeLayer('sentinel-imagery');
      }
      
      if (this.mapInstance.getSource('sentinel-imagery')) {
        this.mapInstance.removeSource('sentinel-imagery');
      }
    } catch (error) {
      console.error('Error cleaning up imagery:', error);
    }
  }
  
  // Change map style with data preservation
  changeMapStyle(styleUrl, preserveData = true) {
    // If we need to preserve data, save the current points and other data
    if (preserveData) {
      const pointsData = store.get('points');
      
      // Check for prediction layers and save their data
      let predictionData = null;
      let deploymentPredictionData = null;
      let hasPredictions = false;
      let hasDeploymentPredictions = false;
      
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
      } catch (e) {
        console.warn('Error checking prediction layers:', e);
      }
      
      // Set up listener to restore points and predictions after style change
      this.mapInstance.once('style.load', () => {
        // Restore points
        this.mapInstance.addSource('points', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: pointsData
          }
        });
        
        // Add the positive points layer
        this.mapInstance.addLayer({
          id: 'point-positive',
          type: 'circle',
          source: 'points',
          filter: ['==', ['get', 'class'], 'positive'],
          paint: {
            'circle-radius': 5,
            'circle-color': '#3a86ff',
            'circle-opacity': 0.9,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff'
          }
        });
        
        // Add the negative points layer
        this.mapInstance.addLayer({
          id: 'point-negative',
          type: 'circle',
          source: 'points',
          filter: ['==', ['get', 'class'], 'negative'],
          paint: {
            'circle-radius': 5,
            'circle-color': '#ff3a5e',
            'circle-opacity': 0.9,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff'
          }
        });
        
        // Update the points source reference
        this.pointsSource = this.mapInstance.getSource('points');
        
        // Restore prediction layers if they existed
        if (hasPredictions && predictionData) {
          this.mapInstance.addSource('predictions', {
            type: 'geojson',
            data: predictionData
          });
          
          this.mapInstance.addLayer({
            id: 'predictions',
            type: 'fill',
            source: 'predictions',
            paint: {
              'fill-color': '#4a90e2',
              'fill-opacity': 0.4,
              'fill-outline-color': '#2c54b2'
            }
          });
        }
        
        // Restore deployment prediction layers if they existed
        if (hasDeploymentPredictions && deploymentPredictionData) {
          this.mapInstance.addSource('deployment-predictions', {
            type: 'geojson',
            data: deploymentPredictionData
          });
          
          this.mapInstance.addLayer({
            id: 'deployment-predictions-line',
            type: 'line',
            source: 'deployment-predictions',
            paint: {
              'line-color': '#FF6F00',
              'line-width': 2,
              'line-opacity': [
                'get', 'confidence'
              ]
            }
          });
        }
        
        // Emit style loaded event
        this.emit('styleLoaded');
      });
    }
    
    // Change the map style
    this.mapInstance.setStyle(styleUrl);
  }
}

// Create a singleton instance
const map = new Map();

export { map };
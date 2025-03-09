// js/components/Map.js
import { EventEmitter } from '../utils/EventEmitter.js';
import { config } from '../config.js';
import { store } from '../state/Store.js';

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
    
    // Add point on click
    this.mapInstance.on('click', (e) => {
      const currentProjectId = store.get('currentProjectId');
      if (!currentProjectId) {
        this.emit('projectRequired');
        return;
      }
      
      const pointClass = document.querySelector('input[name="point-class"]:checked').value;
      this.addPoint(e.lngLat, pointClass);
    });
    
    // Remove point on right click
    this.mapInstance.on('contextmenu', (e) => {
      if (!store.get('currentProjectId')) {
        return;
      }
      
      // Get features at the clicked point
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
    
    // Create a new point feature
    const point = {
      'type': 'Feature',
      'geometry': {
        'type': 'Point',
        'coordinates': [lngLat.lng, lngLat.lat]
      },
      'properties': {
        'id': pointId,
        'class': pointClass
      }
    };
    
    // Add to store
    store.addPoint(point);
    
    // Emit event for other components
    this.emit('pointAdded', point);
    
    // Auto-export points
    if (store.get('currentProjectId')) {
      store.exportPoints();
    }
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
    if (store.get('currentProjectId')) {
      store.exportPoints();
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
  displayPatches(patches, visualizationType) {
    // Clear any existing overlays first
    this.clearVisualization();
    
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
        anchor: 'center',
        scale: 0.6
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
  
  // Fit map to all patches
  fitToPatches(patches) {
    if (patches.length === 0) return;
    
    const bounds = new mapboxgl.LngLatBounds();
    
    patches.forEach(patch => {
      bounds.extend([patch.longitude, patch.latitude]);
    });
    
    this.mapInstance.fitBounds(bounds, {
      padding: 100,
      maxZoom: 15
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
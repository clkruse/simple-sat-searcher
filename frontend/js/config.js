// js/config.js

export const config = {
    // API Configuration
    API_URL: 'http://127.0.0.1:5001',
    MAPBOX_ACCESS_TOKEN: 'pk.eyJ1IjoiY2xrcnVzZSIsImEiOiJjaXIxY2M2dGcwMnNiZnZtZzN0Znk3MXRuIn0.MyKHSjxjG-ZcI2BkRUSGJA',
    
    // Panel configuration
    panels: {
      'control-panel': {
        buttonId: 'point-tool-btn',
        title: 'Label Points'
      },
      'visualization-panel': {
        buttonId: 'visualize-data-btn',
        title: 'Visualize Data'
      },
      'project-modal': {
        buttonId: 'project-selector-btn',
        title: 'Projects'
      },
      'training-panel': {
        buttonId: 'train-model-btn',
        title: 'Train Model'
      },
      'deployment-panel': {
        buttonId: 'deploy-model-btn',
        title: 'Deploy Model'
      },
      'map-imagery-panel': {
        buttonId: 'map-imagery-btn', 
        title: 'Load Map Imagery'
      }
    },
    
    // Map defaults
    mapDefaults: {
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [-86.139373135448025, 34.303025456518071], // Default to CAFOS
      zoom: 2,
      projection: 'globe',
      fitBounds: false
    },
    
    // Extraction defaults
    extractionDefaults: {
      chipSize: 32,
      clearThreshold: 0.75
    },
    
    // Training defaults
    trainingDefaults: {
      batchSize: 8,
      epochs: 64,
      testSplit: 0.1,
      useAugmentation: true
    },
    
    // Deployment defaults
    deploymentDefaults: {
      predThreshold: 0.5,
      clearThreshold: 0.75,
      tileSize: 512,
      tilePadding: 24,
      batchSize: 500,
      tries: 2
    },
    
    // Visualization defaults
    visualizationDefaults: {
      type: 'true_color'
    }
  };
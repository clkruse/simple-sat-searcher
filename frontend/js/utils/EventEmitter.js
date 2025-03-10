// js/utils/EventEmitter.js

/**
 * Simple event emitter implementation for component communication
 */
class EventEmitter {
    constructor() {
      this.events = {};
    }
    
    /**
     * Register an event handler
     * @param {string} eventName - Name of the event to listen for
     * @param {Function} callback - Function to call when the event is emitted
     */
    on(eventName, callback) {
      if (!this.events[eventName]) {
        this.events[eventName] = [];
      }
      this.events[eventName].push(callback);
      
      // Return a function to remove this specific listener
      return () => this.off(eventName, callback);
    }
    
    /**
     * Remove an event handler
     * @param {string} eventName - Name of the event
     * @param {Function} callback - Handler to remove
     */
    off(eventName, callback) {
      if (!this.events[eventName]) return;
      
      this.events[eventName] = this.events[eventName].filter(
        cb => cb !== callback
      );
    }
    
    /**
     * Emit an event with data
     * @param {string} eventName - Name of the event to emit
     * @param {any} data - Data to pass to handlers
     */
    emit(eventName, data) {
      if (!this.events[eventName]) return;
      
      this.events[eventName].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event handler for ${eventName}:`, error);
        }
      });
    }
    
    /**
     * Register a one-time event handler
     * @param {string} eventName - Name of the event to listen for once
     * @param {Function} callback - Function to call when the event is emitted
     */
    once(eventName, callback) {
      const onceWrapper = (...args) => {
        callback(...args);
        this.off(eventName, onceWrapper);
      };
      this.on(eventName, onceWrapper);
    }
  }
  
  export { EventEmitter };
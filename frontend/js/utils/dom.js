// js/utils/dom.js

/**
 * Get element by ID with error handling
 * @param {string} id - Element ID
 * @returns {HTMLElement|null} - The element or null if not found
 */
export function getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      console.warn(`Element with ID "${id}" not found`);
    }
    return element;
  }
  
  /**
   * Create an element with attributes and children
   * @param {string} tag - HTML tag name
   * @param {Object} attributes - Element attributes
   * @param {Array|string} children - Child elements or text content
   * @returns {HTMLElement} - The created element
   */
  export function createElement(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    
    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'innerHTML') {
        element.innerHTML = value;
      } else if (key === 'textContent') {
        element.textContent = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.substring(2).toLowerCase(), value);
      } else {
        element.setAttribute(key, value);
      }
    });
    
    // Add children
    if (typeof children === 'string') {
      element.textContent = children;
    } else if (Array.isArray(children)) {
      children.forEach(child => {
        if (typeof child === 'string') {
          element.appendChild(document.createTextNode(child));
        } else if (child instanceof HTMLElement) {
          element.appendChild(child);
        }
      });
    }
    
    return element;
  }
  
  /**
   * Clear all children from an element
   * @param {HTMLElement} element - The element to clear
   */
  export function clearElement(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }
  
  /**
   * Get the value of a form element with type handling
   * @param {HTMLElement} element - Form element
   * @returns {string|boolean|number} - Element value
   */
  export function getInputValue(element) {
    if (!element) return null;
    
    if (element.type === 'checkbox') {
      return element.checked;
    } else if (element.type === 'number') {
      return parseFloat(element.value);
    } else if (element.type === 'select-multiple') {
      return Array.from(element.selectedOptions).map(option => option.value);
    } else {
      return element.value;
    }
  }
  
  /**
   * Set the value of a form element with type handling
   * @param {HTMLElement} element - Form element
   * @param {any} value - Value to set
   */
  export function setInputValue(element, value) {
    if (!element) return;
    
    if (element.type === 'checkbox') {
      element.checked = Boolean(value);
    } else if (element.type === 'select-multiple' && Array.isArray(value)) {
      Array.from(element.options).forEach(option => {
        option.selected = value.includes(option.value);
      });
    } else {
      element.value = value;
    }
  }
  
  /**
   * Toggle element visibility with optional animation
   * @param {HTMLElement} element - Element to toggle
   * @param {boolean} visible - Whether to show or hide
   * @param {string} className - Class name to toggle
   */
  export function toggleVisibility(element, visible, className = 'hidden') {
    if (!element) return;
    
    if (visible) {
      element.classList.remove(className);
    } else {
      element.classList.add(className);
    }
  }
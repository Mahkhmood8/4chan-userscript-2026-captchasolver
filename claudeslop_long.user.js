// ==UserScript==
// @name         4chan TCaptcha Debugger v14 (Refactored)
// @namespace    4chan-imgui-debugger
// @match        https://*.4chan.org/*
// @match        https://*.4channel.org/*
// @require      https://docs.opencv.org/4.x/opencv.js
// @grant        unsafeWindow
// @run-at       document-end
// @version      14.0
// ==/UserScript==

/**
 * TCaptcha Visual Debugger - Analyzes box-counting CAPTCHAs
 * Uses OpenCV for computer vision + logic parsing to predict answers
 */

(() => {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // GLOBAL REFERENCES
  // ═══════════════════════════════════════════════════════════════════════════
  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const getElementById = (id) => document.getElementById(id);

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════
  const CONFIG = {
    computerVision: {
      morphKernelSize: 5,
      blockSize: 11,
      thresholdConstant: 2,
      minBoxArea: 100,
      approxEpsilon: 0.04,
      angleThreshold: 15,
      erosionFactor: 0.1,
      intensityThreshold: 100,
      emptyThreshold: 0.015,
      nmsOverlapThreshold: 0.6
    },
    ui: {
      width: 550,
      colors: {
        primary: '#007acc',
        error: '#ff3e3e',
        background: '#1e1e1e',
        header: '#252526',
        logBackground: '#000',
        cardBackground: '#2d2d2d',
        predictedCard: '#452121',
        border: '#333',
        borderCard: '#444',
        text: '#eee',
        textMuted: '#888',
        textSecondary: '#6a9955',
        textLog: '#b5cea8'
      }
    },
    timing: {
      retryDelay: 250,
      refreshDelay: 150
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a DOM element with attributes and children
   */
  const createElement = (tagName, attributes = {}, children = []) => {
    const element = document.createElement(tagName);

    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'style') {
        Object.assign(element.style, value);
      } else if (key === 'text') {
        element.textContent = value;
      } else if (key === 'html') {
        element.innerHTML = value;
      } else if (key.startsWith('on')) {
        element.addEventListener(key.slice(2), value);
      } else {
        element.setAttribute(key, value);
      }
    });

    children.forEach(child => {
      element.appendChild(
        typeof child === 'string' ? document.createTextNode(child) : child
      );
    });

    return element;
  };

  /**
   * Calculate Euclidean distance between two points
   */
  const calculateDistance = (pointA, pointB) => {
    return Math.sqrt((pointA.x - pointB.x) ** 2 + (pointA.y - pointB.y) ** 2);
  };

  /**
   * Calculate angle between three points
   */
  const calculateAngle = (p1, p2, p3) => {
    const vector1 = { x: p1.x - p2.x, y: p1.y - p2.y };
    const vector2 = { x: p3.x - p2.x, y: p3.y - p2.y };

    const dotProduct = vector1.x * vector2.x + vector1.y * vector2.y;
    const magnitude1 = Math.sqrt(vector1.x ** 2 + vector1.y ** 2);
    const magnitude2 = Math.sqrt(vector2.x ** 2 + vector2.y ** 2);

    return Math.acos(dotProduct / (magnitude1 * magnitude2 + 1e-7)) * (180 / Math.PI);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // OPENCV MATRIX MEMORY MANAGER
  // ═══════════════════════════════════════════════════════════════════════════

  class MatrixManager {
    constructor() {
      this.matrices = [];
    }

    /**
     * Track matrices for automatic cleanup
     */
    add(...matrices) {
      this.matrices.push(...matrices.flat());
      return matrices.length === 1 ? matrices[0] : matrices;
    }

    /**
     * Free all tracked matrices
     */
    free() {
      this.matrices.forEach(matrix => {
        try {
          if (matrix?.delete && !matrix.isDeleted?.()) {
            matrix.delete();
          }
        } catch (error) {
          // Ignore errors during cleanup
        }
      });
      this.matrices = [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTER VISION MODULE
  // ═══════════════════════════════════════════════════════════════════════════

  const ComputerVision = {
    /**
     * Check if OpenCV is ready
     */
    isReady() {
      return typeof cv !== 'undefined' && cv.Mat;
    },

    /**
     * Analyze image to count empty and total boxes
     */
    analyze(imageElement) {
      if (!this.isReady()) {
        return { empty: 0, total: 0 };
      }

      const matrixManager = new MatrixManager();

      try {
        // Read image and convert to grayscale
        const source = matrixManager.add(cv.imread(imageElement));
        const grayscale = matrixManager.add(new cv.Mat());
        cv.cvtColor(source, grayscale, cv.COLOR_RGBA2GRAY);

        // Apply morphological operations and thresholding
        const boxes = this.detectBoxes(grayscale, matrixManager);

        // Count empty boxes
        const emptyCount = this.countEmptyBoxes(grayscale, boxes, matrixManager);

        return {
          empty: emptyCount,
          total: boxes.length
        };
      } catch (error) {
        return { empty: 0, total: 0 };
      } finally {
        matrixManager.free();
      }
    },

    /**
     * Detect rectangular boxes in the image
     */
    detectBoxes(grayscale, matrixManager) {
      const cfg = CONFIG.computerVision;

      // Morphological black hat operation
      const kernel = matrixManager.add(
        cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(cfg.morphKernelSize, cfg.morphKernelSize))
      );
      const blackhat = matrixManager.add(new cv.Mat());
      cv.morphologyEx(grayscale, blackhat, cv.MORPH_BLACKHAT, kernel);

      // Dual thresholding: Otsu + Adaptive
      const otsuThresh = matrixManager.add(new cv.Mat());
      const adaptiveThresh = matrixManager.add(new cv.Mat());
      cv.threshold(blackhat, otsuThresh, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.adaptiveThreshold(
        blackhat,
        adaptiveThresh,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        cfg.blockSize,
        cfg.thresholdConstant
      );

      // Combine thresholds
      const combined = matrixManager.add(new cv.Mat());
      cv.bitwise_and(otsuThresh, adaptiveThresh, combined);

      // Find contours
      const contours = matrixManager.add(new cv.MatVector());
      const hierarchy = matrixManager.add(new cv.Mat());
      cv.findContours(combined, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

      // Filter and validate rectangular boxes
      let boxes = this.filterRectangularContours(contours, cfg);

      // Apply Non-Maximum Suppression (NMS)
      boxes = this.applyNMS(boxes, cfg.nmsOverlapThreshold);

      return boxes;
    },

    /**
     * Filter contours to find valid rectangular boxes
     */
    filterRectangularContours(contours, config) {
      const boxes = [];

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);

        if (area < config.minBoxArea) continue;

        // Approximate polygon
        const approxPoly = new cv.Mat();
        cv.approxPolyDP(contour, approxPoly, config.approxEpsilon * cv.arcLength(contour, true), true);

        // Check if it's a quadrilateral
        if (approxPoly.rows === 4 && cv.isContourConvex(approxPoly)) {
          const points = [...Array(4)].map((_, j) => ({
            x: approxPoly.data32S[j * 2],
            y: approxPoly.data32S[j * 2 + 1]
          }));

          approxPoly.delete();

          // Verify angles are approximately 90 degrees
          const isRectangle = points.every((_, idx) => {
            const angle = calculateAngle(
              points[(idx + 3) % 4],
              points[idx],
              points[(idx + 1) % 4]
            );
            return Math.abs(angle - 90) <= config.angleThreshold;
          });

          if (isRectangle) {
            const moments = cv.moments(contour);
            if (moments.m00) {
              const boundingRect = cv.boundingRect(contour);
              boxes.push({
                contour,
                centerX: moments.m10 / moments.m00,
                centerY: moments.m01 / moments.m00,
                width: Math.max(boundingRect.width, boundingRect.height),
                area
              });
            }
          }
        } else {
          approxPoly.delete();
        }
      }

      return boxes;
    },

    /**
     * Apply Non-Maximum Suppression to remove overlapping boxes
     */
    applyNMS(boxes, overlapThreshold) {
      boxes.sort((a, b) => b.area - a.area);

      return boxes.filter((box, index) => {
        return !boxes.slice(0, index).some(otherBox => {
          const distance = calculateDistance(
            { x: box.centerX, y: box.centerY },
            { x: otherBox.centerX, y: otherBox.centerY }
          );
          return distance < otherBox.width * overlapThreshold;
        });
      });
    },

    /**
     * Count how many boxes are empty
     */
    countEmptyBoxes(grayscale, boxes, matrixManager) {
      const cfg = CONFIG.computerVision;
      let emptyCount = 0;

      for (const box of boxes) {
        // Create mask for this box
        const mask = matrixManager.add(cv.Mat.zeros(grayscale.rows, grayscale.cols, cv.CV_8UC1));
        const contourVector = matrixManager.add(new cv.MatVector());
        contourVector.push_back(box.contour);
        cv.drawContours(mask, contourVector, 0, new cv.Scalar(255), -1);

        // Erode mask to focus on interior
        const erodedMask = matrixManager.add(new cv.Mat());
        const erosionKernel = matrixManager.add(
          cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3))
        );
        const erosionIterations = Math.max(Math.floor(box.width * cfg.erosionFactor), 1);
        cv.erode(mask, erodedMask, erosionKernel, new cv.Point(-1, -1), erosionIterations);

        // Calculate mean intensity
        const meanIntensity = cv.mean(grayscale, erodedMask)[0];

        // Threshold to find content
        const thresholded = matrixManager.add(new cv.Mat());
        cv.threshold(
          grayscale,
          thresholded,
          Math.min(cfg.intensityThreshold, meanIntensity - 10),
          255,
          cv.THRESH_BINARY_INV
        );

        // Apply mask
        const maskedContent = matrixManager.add(new cv.Mat());
        cv.bitwise_and(thresholded, thresholded, maskedContent, erodedMask);

        // Calculate content ratio
        const contentPixels = cv.countNonZero(maskedContent);
        const totalPixels = cv.countNonZero(erodedMask);
        const contentRatio = contentPixels / totalPixels;

        if (contentRatio < cfg.emptyThreshold) {
          emptyCount++;
        }
      }

      return emptyCount;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LOGIC PARSER - Extract challenge requirements
  // ═══════════════════════════════════════════════════════════════════════════

  const LogicParser = {
    /**
     * Parse challenge HTML to extract logic and target
     */
    parse(html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Remove hidden elements
      doc.querySelectorAll('*').forEach(element => {
        const styleAttr = element.getAttribute('style') || '';
        const isHidden = styleAttr.split(';').some(rule => {
          const [property, value] = rule.split(':').map(part => part?.trim().toLowerCase());
          return (property === 'display' && value === 'none') ||
                 (property === 'visibility' && value === 'hidden');
        });

        if (isHidden) {
          element.remove();
        }
      });

      // Extract and normalize text
      const text = doc.body.textContent
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

      // Determine challenge type
      let type = 'UNKNOWN';
      let target = 0;

      if (text.includes('highest number')) {
        type = 'MAX';
      } else if (text.includes('exactly')) {
        type = 'EXACT';
        const match = text.match(/exactly\s*(\d+)/);
        target = match ? parseInt(match[1], 10) : 0;
      }

      return { type, target, text };
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PREDICTION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  const PredictionEngine = {
    /**
     * Predict which image satisfies the logic
     */
    predict(results, logic) {
      if (logic.type === 'MAX') {
        return this.predictMaximum(results);
      }

      if (logic.type === 'EXACT') {
        return this.predictExact(results, logic.target);
      }

      return { index: -1, isApproximate: false };
    },

    /**
     * Find image with highest number of empty boxes
     */
    predictMaximum(results) {
      const sorted = [...results].sort((a, b) => {
        // Primary: most empty boxes
        if (b.empty !== a.empty) return b.empty - a.empty;
        // Secondary: fewest total boxes (tie-breaker)
        return a.total - b.total;
      });

      const winner = sorted[0];
      return {
        index: winner?.empty > 0 ? winner.index : -1,
        isApproximate: false
      };
    },

    /**
     * Find image with exact number of empty boxes
     */
    predictExact(results, targetCount) {
      // First, try to find exact match
      const exactMatch = results.find(result => result.empty === targetCount);
      if (exactMatch) {
        return { index: exactMatch.index, isApproximate: false };
      }

      // If no exact match, find closest
      const closest = [...results].sort((a, b) => {
        return Math.abs(a.empty - targetCount) - Math.abs(b.empty - targetCount);
      })[0];

      return {
        index: closest?.index ?? -1,
        isApproximate: true
      };
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // USER INTERFACE
  // ═══════════════════════════════════════════════════════════════════════════

  const UserInterface = {
    /**
     * Initialize UI and inject styles
     */
    initialize() {
      const colors = CONFIG.ui.colors;
      const width = CONFIG.ui.width;

      // Inject CSS
      const styleSheet = createElement('style', {
        html: `
          #d { position: fixed; top: 60px; right: 20px; width: ${width}px;
               background: ${colors.background}; border: 1px solid ${colors.border};
               border-top: 4px solid ${colors.primary};
               box-shadow: 0 10px 30px rgba(0,0,0,.8); z-index: 2147483647;
               font-family: 'Segoe UI', sans-serif; color: ${colors.text}; display: none; }

          #h { background: ${colors.header}; padding: 8px 12px; cursor: move;
               display: flex; justify-content: space-between; font-size: 12px;
               font-weight: bold; border-bottom: 1px solid ${colors.border}; user-select: none; }
          #h span:last-child { cursor: pointer; }
          #h span:last-child:hover { color: ${colors.error}; }

          #b { padding: 12px; }

          #l { background: ${colors.logBackground}; padding: 10px; font-size: 14px;
               color: ${colors.textLog}; border: 1px solid ${colors.borderCard};
               margin-bottom: 12px; font-family: monospace; border-radius: 2px;
               word-break: break-word; }

          #g { display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
               max-height: 500px; overflow-y: auto; padding-right: 5px; }

          .c { background: ${colors.cardBackground}; border: 2px solid ${colors.borderCard};
               padding: 6px; cursor: pointer; position: relative; border-radius: 4px;
               transition: border-color .15s, transform .1s; }
          .c:hover { transform: scale(1.02); }
          .c img { width: 100%; display: block; border-radius: 2px; }
          .c.p { border-color: ${colors.error}!important; background: ${colors.predictedCard}; }

          .badge { position: absolute; top: -8px; left: 50%; transform: translateX(-50%);
                   background: ${colors.error}; color: white; font-size: 9px; padding: 2px 8px;
                   border-radius: 10px; font-weight: bold; }

          .f { display: flex; justify-content: space-between; margin-top: 4px;
               font-size: 11px; color: ${colors.textMuted}; }

          #s { margin-top: 12px; font-size: 11px; color: ${colors.textSecondary};
               display: flex; justify-content: space-between; padding-top: 8px;
               border-top: 1px solid ${colors.border}; }

          #g::-webkit-scrollbar { width: 4px; }
          #g::-webkit-scrollbar-thumb { background: ${colors.borderCard}; border-radius: 2px; }
        `
      });
      document.head.appendChild(styleSheet);

      // Create UI structure
      const root = createElement('div', { id: 'd' }, [
        createElement('div', { id: 'h' }, [
          createElement('span', { text: 'TCAPTCHA DEBUGGER v14' }),
          createElement('span', { id: 'x', text: '[X]' })
        ]),
        createElement('div', { id: 'b' }, [
          createElement('div', { id: 'l', text: 'READY' }),
          createElement('div', { id: 'g' }),
          createElement('div', { id: 's' }, [
            createElement('span', { id: 'lg', text: 'LOGIC: IDLE' }),
            createElement('span', { id: 'st', text: 'STEP: 0/0' })
          ])
        ])
      ]);
      document.body.appendChild(root);

      // Setup dragging
      this.setupDragging(root);

      // Setup close button
      getElementById('x').onclick = () => this.hide();
    },

    /**
     * Setup window dragging functionality
     */
    setupDragging(rootElement) {
      let position = { x: 0, y: 0 };
      let isDragging = false;

      getElementById('h').onmousedown = (event) => {
        if (event.target.id === 'x') return;
        isDragging = true;
        position.startX = event.clientX - position.x;
        position.startY = event.clientY - position.y;
      };

      document.onmousemove = (event) => {
        if (!isDragging) return;
        event.preventDefault();
        position.x = event.clientX - position.startX;
        position.y = event.clientY - position.startY;
        rootElement.style.transform = `translate(${position.x}px, ${position.y}px)`;
      };

      document.onmouseup = () => {
        isDragging = false;
      };
    },

    /**
     * Show debugger window
     */
    show() {
      getElementById('d').style.display = 'block';
    },

    /**
     * Hide debugger window
     */
    hide() {
      getElementById('d').style.display = 'none';
    },

    /**
     * Update status display
     */
    updateStatus(promptText, currentStep, totalSteps, logicType, target = null, suffix = '') {
      getElementById('l').textContent = `PROMPT: ${promptText}`;
      getElementById('st').textContent = `STEP: ${currentStep} OF ${totalSteps}`;

      let logicText = `LOGIC: ${logicType}`;
      if (target !== null) logicText += `_${target}`;
      logicText += suffix;

      getElementById('lg').textContent = logicText;
    },

    /**
     * Clear all image cards
     */
    clearCards() {
      getElementById('g').innerHTML = '';
    },

    /**
     * Create an image card
     */
    createCard(index, base64Image, clickHandler) {
      const image = new Image();
      image.src = `data:image/png;base64,${base64Image}`;

      const statsElement = createElement('span', { text: '...' });

      const card = createElement('div', { className: 'c', onclick: clickHandler }, [
        image,
        createElement('div', { className: 'f' }, [
          createElement('span', { text: `#${index}` }),
          statsElement
        ])
      ]);

      getElementById('g').appendChild(card);

      return { card, image, statsElement };
    },

    /**
     * Mark a card as the predicted answer
     */
    markPredicted(card) {
      card.classList.add('p');
      card.appendChild(createElement('div', { className: 'badge', text: 'PREDICTION' }));
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // APPLICATION CONTROLLER
  // ═══════════════════════════════════════════════════════════════════════════

  const Application = {
    /**
     * Initialize and start the application
     */
    start() {
      if (!win.TCaptcha?.setTaskId || !ComputerVision.isReady()) {
        setTimeout(() => this.start(), CONFIG.timing.retryDelay);
        return;
      }

      console.log('[TCaptcha] Ready');
      UserInterface.initialize();

      this.hookTCaptchaAPI();

      // Check if there are existing tasks
      const tcaptcha = win.TCaptcha;
      if (tcaptcha.tasks?.length) {
        this.refresh();
      }
    },

    /**
     * Hook into TCaptcha API methods
     */
    hookTCaptchaAPI() {
      const tcaptcha = win.TCaptcha;

      // Hook methods that trigger UI updates
      const methodsToHook = ['setTaskId', 'setChallenge', 'setTaskItem', 'toggleSlider'];

      methodsToHook.forEach(methodName => {
        const originalMethod = tcaptcha[methodName];
        if (originalMethod) {
          tcaptcha[methodName] = (...args) => {
            const result = originalMethod.apply(tcaptcha, args);
            setTimeout(() => this.refresh(), CONFIG.timing.refreshDelay);
            return result;
          };
        }
      });

      // Hook clearChallenge to hide UI
      const originalClear = tcaptcha.clearChallenge;
      tcaptcha.clearChallenge = (...args) => {
        originalClear?.apply(tcaptcha, args);
        UserInterface.hide();
      };
    },

    /**
     * Refresh the UI and analyze current task
     */
    async refresh() {
      const tcaptcha = win.TCaptcha;
      const currentTask = tcaptcha?.getCurrentTask?.();

      if (!currentTask) {
        UserInterface.hide();
        return;
      }

      UserInterface.show();

      // Parse challenge logic
      const logic = LogicParser.parse(currentTask.str || '');

      // Update status
      const currentStep = (tcaptcha.taskId || 0) + 1;
      const totalSteps = tcaptcha.tasks.length;
      UserInterface.updateStatus(
        logic.text,
        currentStep,
        totalSteps,
        logic.type,
        logic.type === 'EXACT' ? logic.target : null
      );

      // Clear previous cards
      UserInterface.clearCards();

      // Analyze all images
      const results = await this.analyzeAllImages(currentTask.items, tcaptcha);

      // Make prediction
      const prediction = PredictionEngine.predict(results, logic);

      // Highlight predicted answer
      if (prediction.index >= 0) {
        const matchingResult = results.find(result => result.index === prediction.index);
        if (matchingResult) {
          UserInterface.markPredicted(matchingResult.card);

          if (prediction.isApproximate) {
            UserInterface.updateStatus(
              logic.text,
              currentStep,
              totalSteps,
              logic.type,
              logic.target,
              ' (APPROX)'
            );
          }
        }
      }
    },

    /**
     * Analyze all challenge images
     */
    analyzeAllImages(base64Images, tcaptcha) {
      return Promise.all(
        base64Images.map((base64, index) =>
          new Promise(resolve => {
            const { card, image, statsElement } = UserInterface.createCard(
              index,
              base64,
              () => this.selectImage(index, tcaptcha)
            );

            image.onload = () => {
              const analysis = ComputerVision.analyze(image);
              statsElement.textContent = `E:${analysis.empty} T:${analysis.total}`;
              resolve({
                index,
                empty: analysis.empty,
                total: analysis.total,
                card
              });
            };

            image.onerror = () => {
              statsElement.textContent = 'E:? T:?';
              resolve({ index, empty: 0, total: 0, card });
            };
          })
        )
      );
    },

    /**
     * Select an image and submit
     */
    selectImage(index, tcaptcha) {
      if (!tcaptcha.sliderNode) return;

      tcaptcha.sliderNode.value = index + 1;
      tcaptcha.sliderNode.dispatchEvent(new Event('input', { bubbles: true }));
      tcaptcha.onNextClick();
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // START APPLICATION
  // ═══════════════════════════════════════════════════════════════════════════

  Application.start();
})();

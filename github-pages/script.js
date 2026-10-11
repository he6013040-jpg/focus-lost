let slides = [];
let currentSlide = -1;

const testState = {
  active: false,
  completed: false,
  startTime: 0,
  reactionTime: 0,
  totalClicks: 0,
  wrongClicks: 0,
  rafId: null,
  targetIndex: 37,
  duration: 15000,
};

const focusState = {
  base: [100, 100, 75, 35, 100, 100],
  penalties: [0, 0, 0, 0, 0, 0],
};

const interferenceConfig = {
  2: {
    dwell: 620,
    cooldown: 2000,
    maxVisible: 2,
    focusCost: 1,
    items: [
      ['MESSAGE — 01', 'NEW MESSAGE'],
      ['MAIL — 03', 'YOU HAVE 3 NEW EMAILS'],
      ['NOTIFICATION', 'SOMEONE MENTIONED YOU'],
    ],
  },
  3: {
    dwell: 320,
    cooldown: 1000,
    maxVisible: 15,
    focusCost: 2,
    items: [
      ['BREAKING', 'BREAKING NEWS'],
      ['SYSTEM', 'SYSTEM UPDATE AVAILABLE'],
      ['TRENDING', 'TRENDING NOW'],
      ['MESSAGE — 24', '24 NEW NOTIFICATIONS'],
      ['MAIL — 99+', 'YOUR INBOX NEEDS ATTENTION'],
    ],
  },
};

const interferenceState = {
  dwellTimers: new Map(),
  lastTrigger: new Map([[2, -Infinity], [3, -Infinity]]),
  itemIndex: new Map([[2, 0], [3, 0]]),
  generatedCount: new Map([[2, 0], [3, 0]]),
  maxGenerated: 15,
};

const cameraState = {
  stream: null,
  landmarker: null,
  rafId: null,
  loading: false,
  enabled: false,
  lastVideoTime: -1,
  stablePoint: null,
  stableSince: 0,
  triggerPoint: null,
  armed: true,
};

const overloadCycleState = {
  batch: 0,
  respawnTimer: null,
  lastDismissAt: -Infinity,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateFocusLevel(slideIndex) {
  const readout = slides[slideIndex]?.querySelector('.focus-readout strong');
  if (!readout) return;

  const level = clamp(focusState.base[slideIndex] - focusState.penalties[slideIndex], 0, 100);
  if (readout.firstChild) readout.firstChild.nodeValue = String(level);
}

function clearDynamicNotifications(slideIndex) {
  const timer = interferenceState.dwellTimers.get(slideIndex);
  if (timer) window.clearTimeout(timer);
  interferenceState.dwellTimers.delete(slideIndex);
  if (slideIndex === 3) {
    window.clearTimeout(overloadCycleState.respawnTimer);
    overloadCycleState.respawnTimer = null;
    interferenceState.generatedCount.set(3, 0);
  }
  slides[slideIndex]?.querySelector('.dynamic-notification-layer')?.replaceChildren();
  focusState.penalties[slideIndex] = 0;
  updateFocusLevel(slideIndex);
}

function updateInterferenceStatus(message = '') {
  const status = document.getElementById('camera-status');
  if (!status) return;
  const slideIndex = currentSlide === 3 ? 3 : 2;
  const generatedCount = interferenceState.generatedCount.get(slideIndex);
  const count = slideIndex === 3
    ? `${generatedCount} REMAIN · BATCH ${String(Math.max(1, overloadCycleState.batch)).padStart(2, '0')}`
    : `${generatedCount} / ${interferenceState.maxGenerated}`;
  if (message) status.textContent = `${message} · ${count}`;
  else if (slideIndex !== 3 && generatedCount >= interferenceState.maxGenerated) status.textContent = `LIMIT REACHED · ${count}`;
  else status.textContent = `${cameraState.enabled ? 'CAMERA ON' : 'CAMERA OFF'} · ${count}`;
}

function resetInterferenceSession() {
  interferenceState.generatedCount.set(2, 0);
  interferenceState.generatedCount.set(3, 0);
  interferenceState.lastTrigger.set(2, -Infinity);
  interferenceState.lastTrigger.set(3, -Infinity);
  overloadCycleState.batch = 0;
  window.clearTimeout(overloadCycleState.respawnTimer);
  overloadCycleState.respawnTimer = null;
  updateInterferenceStatus();
}

function updateSlideControls() {
  document.getElementById('current-slide-number').textContent = String(currentSlide + 1).padStart(2, '0');
  document.getElementById('previous-slide').disabled = currentSlide === 0;
  document.getElementById('next-slide').disabled = currentSlide === slides.length - 1;

  document.querySelectorAll('[data-slide-index]').forEach((button) => {
    const selected = Number(button.dataset.slideIndex) === currentSlide;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

function showSlide(index) {
  const nextIndex = clamp(index, 0, slides.length - 1);
  if (nextIndex === currentSlide) return;

  const previousIndex = currentSlide;
  const previousSlide = slides[previousIndex];
  if (previousSlide) {
    previousSlide.classList.remove('is-active');
    previousSlide.classList.add('is-exiting');
    previousSlide.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => previousSlide.classList.remove('is-exiting'), 520);
  }

  if (previousIndex === 2 || previousIndex === 3) clearDynamicNotifications(previousIndex);
  if ((previousIndex === 2 || previousIndex === 3) && nextIndex !== 2 && nextIndex !== 3) stopCamera();

  currentSlide = nextIndex;
  const nextSlide = slides[currentSlide];
  nextSlide.classList.remove('is-exiting');
  nextSlide.classList.add('is-active');
  nextSlide.setAttribute('aria-hidden', 'false');

  const darkSlide = currentSlide === 3;
  document.body.classList.toggle('slide-dark', darkSlide);
  document.querySelector('.site-header')?.classList.toggle('on-dark', darkSlide);
  updateFocusLevel(currentSlide);
  updateSlideControls();
  document.getElementById('camera-tools').hidden = currentSlide !== 2 && currentSlide !== 3;
  updateInterferenceStatus();
  if (currentSlide === 3) {
    overloadCycleState.respawnTimer = window.setTimeout(spawnOverloadBatch, 80);
  }
}

function initSlideNavigation() {
  document.querySelectorAll('[data-slide-target]').forEach((control) => {
    control.addEventListener('click', (event) => {
      event.preventDefault();
      showSlide(Number(control.dataset.slideTarget));
    });
  });

  document.querySelectorAll('[data-slide-index]').forEach((button) => {
    button.addEventListener('click', () => showSlide(Number(button.dataset.slideIndex)));
  });

  document.getElementById('previous-slide').addEventListener('click', () => showSlide(currentSlide - 1));
  document.getElementById('next-slide').addEventListener('click', () => showSlide(currentSlide + 1));

  document.addEventListener('keydown', (event) => {
    if (testState.active) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      showSlide(currentSlide + 1);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showSlide(currentSlide - 1);
    }
  });

  window.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
  showSlide(0);
}

function dismissElement(element) {
  element.classList.add('is-closing');
  window.setTimeout(() => element.remove(), 240);
}

function initNotifications() {
  document.querySelectorAll('.notification > button').forEach((button) => {
    button.addEventListener('click', () => dismissElement(button.closest('.notification')));
  });
  document.querySelectorAll('.signal.dismissible').forEach((signal) => {
    signal.addEventListener('click', () => dismissElement(signal));
  });
}

function buildCursorNotification(slideIndex, clientX, clientY, options = {}) {
  const generatedCount = interferenceState.generatedCount.get(slideIndex);
  if (currentSlide !== slideIndex || (!options.batch && generatedCount >= interferenceState.maxGenerated)) {
    updateInterferenceStatus();
    return false;
  }
  const config = interferenceConfig[slideIndex];
  const layer = slides[slideIndex].querySelector('.dynamic-notification-layer');
  if (!layer || layer.childElementCount >= config.maxVisible) return false;

  const itemIndex = interferenceState.itemIndex.get(slideIndex) % config.items.length;
  const [category, message] = config.items[itemIndex];
  interferenceState.itemIndex.set(slideIndex, itemIndex + 1);

  const card = document.createElement('article');
  card.className = 'cursor-notification';
  const cardHeader = document.createElement('header');
  const categoryLabel = document.createElement('span');
  const statusDot = document.createElement('i');
  const time = document.createElement('time');
  const body = document.createElement('strong');
  const closeButton = document.createElement('button');

  categoryLabel.append(statusDot, document.createTextNode(category));
  time.textContent = 'NOW';
  cardHeader.append(categoryLabel, time);
  body.textContent = message;
  closeButton.type = 'button';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', `关闭 ${category} 通知`);
  closeButton.addEventListener('click', () => {
    if (slideIndex === 3) dismissOverloadNotification(card);
    else dismissElement(card);
  });
  card.append(cardHeader, body, closeButton);
  layer.append(card);

  const offset = 26;
  const margin = 18;
  const headerHeight = 58;
  const controlsHeight = 62;
  const cardWidth = card.offsetWidth;
  const cardHeight = card.offsetHeight;
  if (Number.isInteger(options.gridIndex)) {
    const randomValue = (salt) => {
      const raw = Math.sin((overloadCycleState.batch * 97 + options.gridIndex * 31 + salt) * 12.9898) * 43758.5453;
      return raw - Math.floor(raw);
    };
    const width = clamp(220 + randomValue(4) * 60, 220, Math.min(280, layer.clientWidth - margin * 2));
    const availableWidth = Math.max(0, layer.clientWidth - width - (margin * 2));
    const availableHeight = Math.max(0, layer.clientHeight - cardHeight - (margin * 2));
    const left = margin + randomValue(1) * availableWidth;
    const top = margin + randomValue(2) * availableHeight;
    const rotation = -2.2 + randomValue(3) * 4.4;
    card.style.width = `${width}px`;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.rotate = `${rotation.toFixed(2)}deg`;
    card.style.zIndex = String(2 + Math.floor(randomValue(5) * 8));
  } else {
    let left = clientX + offset;
    let top = clientY - headerHeight + offset;

    if (left + cardWidth > window.innerWidth - margin) left = clientX - cardWidth - offset;
    if (clientY + offset + cardHeight > window.innerHeight - controlsHeight - margin) {
      top = clientY - headerHeight - cardHeight - offset;
    }

    card.style.left = `${clamp(left, margin, window.innerWidth - cardWidth - margin)}px`;
    card.style.top = `${clamp(top, margin, window.innerHeight - headerHeight - controlsHeight - cardHeight - margin)}px`;
  }

  if (!options.batch) {
    interferenceState.generatedCount.set(slideIndex, generatedCount + 1);
    focusState.penalties[slideIndex] += config.focusCost;
    updateFocusLevel(slideIndex);
    updateInterferenceStatus();
  }
  return card;
}

function spawnOverloadBatch() {
  if (currentSlide !== 3) return;
  const layer = slides[3].querySelector('.dynamic-notification-layer');
  if (!layer) return;

  layer.replaceChildren();
  overloadCycleState.batch += 1;
  overloadCycleState.respawnTimer = null;
  interferenceState.generatedCount.set(3, 0);

  for (let index = 0; index < interferenceState.maxGenerated; index += 1) {
    buildCursorNotification(3, 0, 0, { batch: true, gridIndex: index });
  }

  interferenceState.generatedCount.set(3, layer.childElementCount);
  updateInterferenceStatus();
}

function scheduleNextOverloadBatch() {
  if (currentSlide !== 3 || overloadCycleState.respawnTimer) return;
  overloadCycleState.respawnTimer = window.setTimeout(spawnOverloadBatch, 700);
}

function dismissOverloadNotification(card) {
  if (!card || card.classList.contains('is-closing')) return;
  card.classList.add('is-closing');
  window.setTimeout(() => {
    card.remove();
    const remaining = slides[3]?.querySelectorAll('.cursor-notification').length ?? 0;
    interferenceState.generatedCount.set(3, remaining);
    updateInterferenceStatus();
    if (remaining === 0) scheduleNextOverloadBatch();
  }, 240);
}

function dismissOverloadAtHand(clientX, clientY, now) {
  if (now - overloadCycleState.lastDismissAt < 180) return;
  const cards = [...slides[3].querySelectorAll('.cursor-notification:not(.is-closing)')];
  const hitPadding = 24;
  const card = cards.reverse().find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return clientX >= rect.left - hitPadding && clientX <= rect.right + hitPadding
      && clientY >= rect.top - hitPadding && clientY <= rect.bottom + hitPadding;
  });
  if (!card) return;
  overloadCycleState.lastDismissAt = now;
  dismissOverloadNotification(card);
}

function scheduleCursorNotification(event, slideIndex) {
  if (slideIndex === 3) return;
  if (currentSlide !== slideIndex || event.target.closest('button, a, .slide-controls, .site-header')) return;
  const config = interferenceConfig[slideIndex];
  const existingTimer = interferenceState.dwellTimers.get(slideIndex);
  if (existingTimer) window.clearTimeout(existingTimer);

  const { clientX, clientY } = event;
  const timer = window.setTimeout(() => {
    if (performance.now() - interferenceState.lastTrigger.get(slideIndex) < config.cooldown) return;
    if (clientY < 76 || clientY > window.innerHeight - 86) return;
    interferenceState.lastTrigger.set(slideIndex, performance.now());
    buildCursorNotification(slideIndex, clientX, clientY);
  }, config.dwell);
  interferenceState.dwellTimers.set(slideIndex, timer);
}

function initCursorInterference() {
  const hasHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  [2, 3].forEach((slideIndex) => {
    if (hasHover) {
      slides[slideIndex].addEventListener('mousemove', (event) => scheduleCursorNotification(event, slideIndex));
      slides[slideIndex].addEventListener('mouseleave', () => {
        const timer = interferenceState.dwellTimers.get(slideIndex);
        if (timer) window.clearTimeout(timer);
      });
    } else {
      slides[slideIndex].addEventListener('click', (event) => {
        if (slideIndex === 3) return;
        if (event.target.closest('button, a')) return;
        const config = interferenceConfig[slideIndex];
        if (performance.now() - interferenceState.lastTrigger.get(slideIndex) < config.cooldown) return;
        interferenceState.lastTrigger.set(slideIndex, performance.now());
        buildCursorNotification(slideIndex, event.clientX, event.clientY);
      });
    }
  });
}

function resetCameraTracking() {
  cameraState.stablePoint = null;
  cameraState.stableSince = 0;
  cameraState.triggerPoint = null;
  cameraState.armed = true;
  document.getElementById('hand-position-marker')?.classList.remove('is-visible');
}

async function loadHandLandmarker() {
  if (cameraState.landmarker) return cameraState.landmarker;
  const visionTasks = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs');
  const vision = await visionTasks.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm');
  cameraState.landmarker = await visionTasks.HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5,
  });
  return cameraState.landmarker;
}

function handleHandPosition(clientX, clientY, now) {
  if (currentSlide !== 2 && currentSlide !== 3) return;
  const marker = document.getElementById('hand-position-marker');
  marker.style.left = `${clientX}px`;
  marker.style.top = `${clientY}px`;
  marker.classList.add('is-visible');

  if (currentSlide === 3) {
    dismissOverloadAtHand(clientX, clientY, now);
    return;
  }

  const config = interferenceConfig[currentSlide];
  const point = { x: clientX, y: clientY };
  const distanceFromStable = cameraState.stablePoint
    ? Math.hypot(point.x - cameraState.stablePoint.x, point.y - cameraState.stablePoint.y)
    : Infinity;

  if (!cameraState.armed && cameraState.triggerPoint) {
    const distanceFromTrigger = Math.hypot(point.x - cameraState.triggerPoint.x, point.y - cameraState.triggerPoint.y);
    if (distanceFromTrigger > 90) {
      cameraState.armed = true;
      cameraState.stablePoint = point;
      cameraState.stableSince = now;
    }
  }

  if (distanceFromStable > 64) {
    cameraState.stablePoint = point;
    cameraState.stableSince = now;
    return;
  }

  if (!cameraState.armed || now - cameraState.stableSince < config.dwell) return;
  if (now - interferenceState.lastTrigger.get(currentSlide) < config.cooldown) return;
  if (clientY < 76 || clientY > window.innerHeight - 86) return;

  if (buildCursorNotification(currentSlide, clientX, clientY)) {
    interferenceState.lastTrigger.set(currentSlide, now);
    cameraState.triggerPoint = point;
    cameraState.armed = false;
  }
}

function trackCameraFrame(now) {
  if (!cameraState.enabled) return;
  const video = document.getElementById('camera-feed');

  if (video.readyState >= 2 && video.currentTime !== cameraState.lastVideoTime) {
    cameraState.lastVideoTime = video.currentTime;
    const result = cameraState.landmarker.detectForVideo(video, now);
    const landmarks = result.landmarks?.[0];
    if (landmarks) {
      const palm = landmarks[9];
      handleHandPosition((1 - palm.x) * window.innerWidth, palm.y * window.innerHeight, now);
    } else resetCameraTracking();
  }

  cameraState.rafId = requestAnimationFrame(trackCameraFrame);
}

function stopCamera() {
  cancelAnimationFrame(cameraState.rafId);
  cameraState.stream?.getTracks().forEach((track) => track.stop());
  cameraState.stream = null;
  cameraState.enabled = false;
  cameraState.lastVideoTime = -1;
  const video = document.getElementById('camera-feed');
  if (video) video.srcObject = null;
  const button = document.getElementById('camera-toggle');
  if (button) {
    button.textContent = 'ENABLE CAMERA';
    button.setAttribute('aria-pressed', 'false');
    button.disabled = false;
  }
  resetCameraTracking();
  updateInterferenceStatus();
}

async function startCamera() {
  if (cameraState.loading || cameraState.enabled) return;
  const button = document.getElementById('camera-toggle');
  cameraState.loading = true;
  button.disabled = true;
  updateInterferenceStatus('LOADING CAMERA');

  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable');
    await loadHandLandmarker();
    cameraState.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const video = document.getElementById('camera-feed');
    video.srcObject = cameraState.stream;
    await video.play();
    cameraState.enabled = true;
    cameraState.loading = false;
    button.disabled = false;
    button.textContent = 'DISABLE CAMERA';
    button.setAttribute('aria-pressed', 'true');
    updateInterferenceStatus('CAMERA ON');
    cameraState.rafId = requestAnimationFrame(trackCameraFrame);
  } catch (error) {
    cameraState.loading = false;
    stopCamera();
    updateInterferenceStatus(error?.name === 'NotAllowedError' ? 'CAMERA DENIED' : 'CAMERA UNAVAILABLE');
  }
}

function initCameraInterference() {
  const button = document.getElementById('camera-toggle');
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    if (cameraState.enabled) stopCamera();
    else startCamera();
  });
  updateInterferenceStatus();
}

function buildCharacterGrid() {
  const grid = document.getElementById('character-grid');
  grid.replaceChildren();

  for (let index = 0; index < 64; index += 1) {
    const character = document.createElement('button');
    const isTarget = index === testState.targetIndex;
    character.type = 'button';
    character.className = 'character';
    character.textContent = isTarget ? '0' : 'O';
    character.dataset.target = String(isTarget);
    character.setAttribute('aria-label', `字符 ${index + 1}`);
    character.disabled = true;
    grid.append(character);
  }
}

function updateTimer(now) {
  if (!testState.active) return;
  const elapsed = now - testState.startTime;
  const remaining = Math.max(0, testState.duration - elapsed);
  document.getElementById('timer').textContent = String(Math.ceil(remaining / 1000)).padStart(2, '0');

  if (remaining <= 0) {
    finishTimedOutTest();
    return;
  }
  testState.rafId = requestAnimationFrame(updateTimer);
}

function setGridEnabled(enabled) {
  document.querySelectorAll('.character').forEach((character) => {
    character.disabled = !enabled;
  });
}

function resetFocusTest(clearResult = true) {
  cancelAnimationFrame(testState.rafId);
  Object.assign(testState, {
    active: false,
    completed: false,
    startTime: 0,
    reactionTime: 0,
    totalClicks: 0,
    wrongClicks: 0,
    rafId: null,
  });

  document.body.classList.remove('test-in-progress');
  document.getElementById('focus-test').classList.remove('test-running');
  const grid = document.getElementById('character-grid');
  grid.classList.remove('is-active');
  grid.setAttribute('aria-hidden', 'true');
  grid.querySelectorAll('.character').forEach((character) => character.classList.remove('correct'));
  setGridEnabled(false);

  const startButton = document.getElementById('start-test');
  startButton.innerHTML = 'START TEST <span aria-hidden="true">→</span>';
  startButton.hidden = false;
  document.getElementById('view-result').hidden = true;
  document.getElementById('timer').textContent = '15';
  document.getElementById('test-message').textContent = 'READY WHEN YOU ARE';

  if (clearResult) {
    document.getElementById('focus-score').textContent = '--';
    document.getElementById('reaction-result').textContent = '--';
    document.getElementById('misclick-result').textContent = '0';
    document.getElementById('click-result').textContent = '0';
  }
}

function startTest() {
  resetFocusTest(false);
  testState.active = true;
  testState.startTime = performance.now();
  document.body.classList.add('test-in-progress');
  document.getElementById('focus-test').classList.add('test-running');

  const grid = document.getElementById('character-grid');
  document.getElementById('start-test').hidden = true;
  document.getElementById('test-message').textContent = 'FIND THE 0';
  grid.classList.add('is-active');
  grid.setAttribute('aria-hidden', 'false');
  setGridEnabled(true);
  testState.rafId = requestAnimationFrame(updateTimer);
}

function completeTest(target) {
  testState.active = false;
  testState.completed = true;
  testState.reactionTime = performance.now() - testState.startTime;
  cancelAnimationFrame(testState.rafId);
  document.body.classList.remove('test-in-progress');
  target.classList.add('correct');
  setGridEnabled(false);
  document.getElementById('test-message').textContent = 'CORRECT';
  document.getElementById('view-result').hidden = false;
  renderResult();
}

function finishTimedOutTest() {
  testState.active = false;
  testState.reactionTime = testState.duration;
  document.body.classList.remove('test-in-progress');
  document.getElementById('focus-test').classList.remove('test-running');
  setGridEnabled(false);
  document.getElementById('timer').textContent = '00';
  document.getElementById('test-message').textContent = 'TIME OUT — TRY AGAIN';
  const startButton = document.getElementById('start-test');
  startButton.innerHTML = 'RESTART TEST <span aria-hidden="true">→</span>';
  startButton.hidden = false;
}

function calculateFocusScore() {
  const reactionSeconds = testState.reactionTime / 1000;
  const timePenalty = Math.max(0, reactionSeconds - 1) * 6;
  const score = 100 - (testState.wrongClicks * 8) - timePenalty;
  return clamp(Math.round(score), 0, 100);
}

function renderResult() {
  document.getElementById('focus-score').textContent = calculateFocusScore();
  document.getElementById('reaction-result').textContent = `${(testState.reactionTime / 1000).toFixed(2)}s`;
  document.getElementById('misclick-result').textContent = testState.wrongClicks;
  document.getElementById('click-result').textContent = testState.totalClicks;
}

function initFocusTest() {
  buildCharacterGrid();
  resetFocusTest();
  document.getElementById('start-test').addEventListener('click', startTest);
  document.getElementById('character-grid').addEventListener('click', (event) => {
    const character = event.target.closest('.character');
    if (!character || !testState.active) return;
    testState.totalClicks += 1;
    if (character.dataset.target === 'true') completeTest(character);
    else {
      testState.wrongClicks += 1;
      document.getElementById('test-message').textContent = 'KEEP LOOKING';
    }
  });

  document.getElementById('view-result').addEventListener('click', () => showSlide(5));
  document.getElementById('retry-test').addEventListener('click', () => {
    resetFocusTest();
    clearDynamicNotifications(2);
    clearDynamicNotifications(3);
    resetInterferenceSession();
    stopCamera();
    showSlide(0);
  });
}

function initEscapeText() {
  const escapeText = document.querySelector('.escape-text');
  const section = document.getElementById('overload');
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');
  if (!escapeText || !section || !canHover.matches) return;

  section.addEventListener('mousemove', (event) => {
    const rect = escapeText.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = centerX - event.clientX;
    const deltaY = centerY - event.clientY;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance < 180 && distance > 0) {
      const force = (180 - distance) / 180;
      const moveX = (deltaX / distance) * force * 30;
      const moveY = (deltaY / distance) * force * 30;
      escapeText.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    } else escapeText.style.transform = 'translate(-50%, -50%)';
  });

  section.addEventListener('mouseleave', () => {
    escapeText.style.transform = 'translate(-50%, -50%)';
  });
}

function init() {
  slides = [...document.querySelectorAll('.section')];
  slides.forEach((slide, index) => {
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${index + 1} of ${slides.length}`);
    slide.setAttribute('aria-hidden', 'true');
  });
  initNotifications();
  initFocusTest();
  initEscapeText();
  initCursorInterference();
  initCameraInterference();
  initSlideNavigation();
}

document.addEventListener('DOMContentLoaded', init);

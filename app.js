// =====================================================
// US 83 NEED INDEX EXPLORER
// VERSION 5.0
// =====================================================

console.log("US 83 Need Index Explorer version 5.0");


// =====================================================
// MAP EXTENT AND BASEMAP
// =====================================================

const EXT = {
  west: -103.356215,
  east: -96.940124,
  south: 25.684963,
  north: 36.796656
};

const BASEMAP =
  "https://raw.githubusercontent.com/JSMITHHDR/US-83/5165469a29e097b35ddc90d6901b971ff3d13df0/State%20Narrow.png";


// =====================================================
// DISPLAY SETTINGS
// =====================================================

const DISPLAY = {
  // Positive X moves the basemap right.
  basemapShiftX: 0,

  // Negative Y moves the basemap up.
  basemapShiftY: -7,

  // Colored roadway line width.
  lineWidth: 8
};


// =====================================================
// FOUR FIXED COLOR BUCKETS
// =====================================================

const COLOR_BUCKETS = [
  {
    min: 0.00,
    max: 0.25,
    color: "#38A800",
    label: "Low"
  },
  {
    min: 0.25,
    max: 0.50,
    color: "#FFFF00",
    label: "Moderate"
  },
  {
    min: 0.50,
    max: 0.75,
    color: "#E69800",
    label: "High"
  },
  {
    min: 0.75,
    max: Infinity,
    color: "#FF0000",
    label: "Very High"
  }
];


// =====================================================
// APPLICATION STATE
// =====================================================

const state = {
  segments: [],
  indices: [],

  // Combined Need Index by Segment ID.
  scores: new Map(),

  // Four-bucket color assignment by Segment ID.
  colorBuckets: new Map(),

  // Index-level slider weights.
  indexW: {},

  // Field-level slider weights.
  fieldW: {},

  // Controls whether the Future Volume Factor is applied.
  useFutureVolumeFactor: true
};


// =====================================================
// DOM REFERENCES
// =====================================================

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

const statusEl = document.getElementById("status");
const indexWeightsDiv = document.getElementById("indexWeights");
const fieldWeightsDiv = document.getElementById("fieldWeights");


// =====================================================
// BASEMAP IMAGE
// =====================================================

const basemap = new Image();

basemap.crossOrigin = "anonymous";
basemap.src = BASEMAP;

basemap.onload = function () {
  draw();
};

basemap.onerror = function () {
  if (statusEl) {
    statusEl.textContent =
      "Basemap could not load. Verify that the raw GitHub image is available.";
  }

  draw();
};


// =====================================================
// GENERAL HELPERS
// =====================================================

function safeNumber(value, fallback = null) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    String(value).trim().toLowerCase() === "n/a"
  ) {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}


function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function displayName(value) {
  return String(value)
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}


function getSegmentId(item) {
  return String(
    item.segmentId ??
    item.segmentID ??
    item.SegmentID ??
    item["Segment ID"] ??
    item.id ??
    ""
  );
}


// =====================================================
// CANVAS SIZE
// =====================================================

function resizeCanvas() {
  if (!canvas) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;

  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  draw();
}


// =====================================================
// MAP PROJECTION
// =====================================================

function project(lon, lat) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  const x =
    ((lon - EXT.west) / (EXT.east - EXT.west)) *
    width;

  const y =
    ((EXT.north - lat) / (EXT.north - EXT.south)) *
    height;

  return [x, y];
}


// =====================================================
// FUTURE VOLUME FACTOR
// =====================================================

function getFutureVolumeFactor(row) {
  const possibleProperties = [
    "futureVolumeFactor",
    "FutureVolumeFactor",
    "future_volume_factor",
    "Future Volume Factor",
    "FUTURE VOLUME FACTOR",
    "futureFactor",
    "FutureFactor"
  ];

  for (const property of possibleProperties) {
    if (
      Object.prototype.hasOwnProperty.call(row, property)
    ) {
      const factor = safeNumber(row[property], null);

      if (factor !== null) {
        return factor;
      }
    }
  }

  if (row.values && typeof row.values === "object") {
    for (const property of possibleProperties) {
      if (
        Object.prototype.hasOwnProperty.call(
          row.values,
          property
        )
      ) {
        const factor = safeNumber(
          row.values[property],
          null
        );

        if (factor !== null) {
          return factor;
        }
      }
    }
  }

  // A missing factor should not erase the index score.
  return 1;
}


// =====================================================
// NORMALIZE FIELD VALUES
// =====================================================

function normalizeFieldValue(rawValue, field) {
  const value = safeNumber(rawValue, null);

  if (value === null) {
    return null;
  }

  /*
    The index JSON may include a maximum value for fields
    whose original values exceed the normal 0-to-1 scale.
  */

  if (
    field &&
    typeof field === "object"
  ) {
    const maximum = safeNumber(
      field.max ??
      field.maximum ??
      field.observedMax,
      null
    );

    if (maximum !== null && maximum > 1) {
      return value / maximum;
    }
  }

  return value;
}


// =====================================================
// FIELD INFORMATION HELPERS
// =====================================================

function getFieldId(field) {
  if (typeof field === "string") {
    return field;
  }

  return String(
    field.id ??
    field.field ??
    field.name ??
    field.key ??
    ""
  );
}


function getFieldLabel(field) {
  if (typeof field === "string") {
    return displayName(field);
  }

  return (
    field.label ??
    field.displayName ??
    field.name ??
    displayName(getFieldId(field))
  );
}


function getRowFieldValue(row, fieldId) {
  if (
    row.values &&
    Object.prototype.hasOwnProperty.call(
      row.values,
      fieldId
    )
  ) {
    return row.values[fieldId];
  }

  if (
    Object.prototype.hasOwnProperty.call(
      row,
      fieldId
    )
  ) {
    return row[fieldId];
  }

  return null;
}


// =====================================================
// CALCULATE ONE INDEX
// =====================================================

function scoreRow(row, index) {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const field of index.fields || []) {
    const fieldId = getFieldId(field);
    const rawValue = getRowFieldValue(row, fieldId);

    const normalizedValue = normalizeFieldValue(
      rawValue,
      field
    );

    if (normalizedValue === null) {
      continue;
    }

    const fieldWeights =
      state.fieldW[index.id] || {};

    const weight = Math.max(
      0,
      safeNumber(fieldWeights[fieldId], 1)
    );

    if (weight === 0) {
      continue;
    }

    weightedSum += normalizedValue * weight;
    weightTotal += weight;
  }

  if (weightTotal <= 0) {
    return null;
  }

  const baseIndexScore = weightedSum / weightTotal;

  if (!state.useFutureVolumeFactor) {
    return baseIndexScore;
  }

  const futureVolumeFactor =
    getFutureVolumeFactor(row);

  return baseIndexScore * futureVolumeFactor;
}


// =====================================================
// FIND AN INDEX ROW FOR A SEGMENT
// =====================================================

function findIndexRow(index, segmentId) {
  const rows =
    index.rows ??
    index.data ??
    index.records ??
    [];

  return rows.find(function (row) {
    return getSegmentId(row) === segmentId;
  });
}


// =====================================================
// ACTIVE INDEX WEIGHT TOTAL
// =====================================================

function activeIndexWeightTotal() {
  return state.indices.reduce(function (total, index) {
    const weight = Math.max(
      0,
      safeNumber(state.indexW[index.id], 0)
    );

    return total + weight;
  }, 0);
}


// =====================================================
// RECALCULATE COMBINED NEED INDEX
// =====================================================

function recalculate() {
  state.scores.clear();
  state.colorBuckets.clear();

  const totalActiveWeight = activeIndexWeightTotal();

  /*
    If all five index sliders are zero, clear the lines
    instead of displaying a default green line.
  */

  if (totalActiveWeight <= 0) {
    draw();

    if (statusEl) {
      statusEl.textContent =
        "All index weights are zero. No scored segments are displayed.";
    }

    return;
  }

  for (const segment of state.segments) {
    const segmentId = getSegmentId(segment);

    let weightedScoreTotal = 0;
    let appliedWeightTotal = 0;

    for (const index of state.indices) {
      const indexWeight = Math.max(
        0,
        safeNumber(state.indexW[index.id], 0)
      );

      if (indexWeight === 0) {
        continue;
      }

      const row = findIndexRow(index, segmentId);

      if (!row) {
        continue;
      }

      const indexScore = scoreRow(row, index);

      if (
        indexScore === null ||
        !Number.isFinite(indexScore)
      ) {
        continue;
      }

      weightedScoreTotal +=
        indexScore * indexWeight;

      appliedWeightTotal += indexWeight;
    }

    if (appliedWeightTotal <= 0) {
      continue;
    }

    const combinedScore =
      weightedScoreTotal / appliedWeightTotal;

    state.scores.set(
      segmentId,
      combinedScore
    );

    state.colorBuckets.set(
      segmentId,
      getColorBucket(combinedScore)
    );
  }

  draw();

  if (statusEl) {
    const factorStatus =
      state.useFutureVolumeFactor
        ? "Future Volume Factor on"
        : "Future Volume Factor off";

    statusEl.textContent =
      `${state.scores.size} segments displayed. ${factorStatus}.`;
  }
}


// =====================================================
// FIXED COLOR BUCKET ASSIGNMENT
// =====================================================

function getColorBucket(score) {
  const value = safeNumber(score, 0);

  for (let index = 0; index < COLOR_BUCKETS.length; index += 1) {
    const bucket = COLOR_BUCKETS[index];

    const isLast =
      index === COLOR_BUCKETS.length - 1;

    const insideBucket =
      value >= bucket.min &&
      (isLast
        ? value <= bucket.max
        : value < bucket.max);

    if (insideBucket) {
      return bucket;
    }
  }

  return COLOR_BUCKETS[COLOR_BUCKETS.length - 1];
}


// =====================================================
// SEGMENT VERTEX HELPERS
// =====================================================

function getVertices(segment) {
  return (
    segment.vertices ??
    segment.points ??
    segment.coordinates ??
    segment.path ??
    []
  );
}


function getLongitude(vertex) {
  if (Array.isArray(vertex)) {
    return safeNumber(vertex[0], null);
  }

  return safeNumber(
    vertex.lon ??
    vertex.lng ??
    vertex.longitude ??
    vertex.Longitude ??
    vertex.LONGITUDE ??
    vertex.x,
    null
  );
}


function getLatitude(vertex) {
  if (Array.isArray(vertex)) {
    return safeNumber(vertex[1], null);
  }

  return safeNumber(
    vertex.lat ??
    vertex.latitude ??
    vertex.Latitude ??
    vertex.LATITUDE ??
    vertex.y,
    null
  );
}


// =====================================================
// DRAW MAP
// =====================================================

function draw() {
  if (!canvas || !ctx) {
    return;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  ctx.clearRect(0, 0, width, height);

  // Draw the shifted basemap.
  if (
    basemap.complete &&
    basemap.naturalWidth > 0
  ) {
    ctx.drawImage(
      basemap,
      DISPLAY.basemapShiftX,
      DISPLAY.basemapShiftY,
      width,
      height
    );
  }

  /*
    Do not draw any roadway lines when every index
    weight is set to zero.
  */

  if (activeIndexWeightTotal() <= 0) {
    return;
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = DISPLAY.lineWidth;

  for (const segment of state.segments) {
    const segmentId = getSegmentId(segment);
    const bucket = state.colorBuckets.get(segmentId);

    if (!bucket) {
      continue;
    }

    const vertices = getVertices(segment);

    if (!Array.isArray(vertices) || vertices.length < 2) {
      continue;
    }

    ctx.beginPath();

    let started = false;

    for (const vertex of vertices) {
      const lon = getLongitude(vertex);
      const lat = getLatitude(vertex);

      if (lon === null || lat === null) {
        continue;
      }

      const [x, y] = project(lon, lat);

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }

    if (!started) {
      continue;
    }

    // One stroke only. No casing or outline.
    ctx.strokeStyle = bucket.color;
    ctx.stroke();
  }
}


// =====================================================
// CREATE A SLIDER
// =====================================================

function createSlider(options) {
  const wrapper = document.createElement("div");
  wrapper.className = "slider-control";

  const header = document.createElement("div");
  header.className = "slider-header";

  const label = document.createElement("label");
  label.htmlFor = options.id;
  label.textContent = options.label;

  const output = document.createElement("output");
  output.htmlFor = options.id;
  output.textContent =
    Number(options.value).toFixed(1);

  const input = document.createElement("input");

  input.type = "range";
  input.id = options.id;
  input.min = String(options.min ?? 0);
  input.max = String(options.max ?? 2);
  input.step = String(options.step ?? 0.1);
  input.value = String(options.value);

  header.appendChild(label);
  header.appendChild(output);

  wrapper.appendChild(header);
  wrapper.appendChild(input);

  input.addEventListener("input", function () {
    const value = safeNumber(input.value, 0);

    output.textContent = value.toFixed(1);

    options.onInput(value);
  });

  return wrapper;
}


// =====================================================
// BUILD INDEX-WEIGHT SLIDERS
// =====================================================

function buildIndexControls() {
  if (!indexWeightsDiv) {
    return;
  }

  indexWeightsDiv.innerHTML = "";

  for (const index of state.indices) {
    if (
      !Object.prototype.hasOwnProperty.call(
        state.indexW,
        index.id
      )
    ) {
      state.indexW[index.id] = 1;
    }

    const control = createSlider({
      id: `index-weight-${index.id}`,
      label:
        index.label ??
        index.name ??
        displayName(index.id),
      value: state.indexW[index.id],
      min: 0,
      max: 2,
      step: 0.1,
      onInput: function (value) {
        state.indexW[index.id] = value;
        recalculate();
      }
    });

    indexWeightsDiv.appendChild(control);
  }
}


// =====================================================
// BUILD FIELD-WEIGHT SLIDERS
// =====================================================

function buildFieldControls() {
  if (!fieldWeightsDiv) {
    return;
  }

  fieldWeightsDiv.innerHTML = "";

  for (const index of state.indices) {
    const section = document.createElement("section");
    section.className = "field-weight-group";

    const heading = document.createElement("h3");

    heading.textContent =
      index.label ??
      index.name ??
      displayName(index.id);

    section.appendChild(heading);

    if (!state.fieldW[index.id]) {
      state.fieldW[index.id] = {};
    }

    for (const field of index.fields || []) {
      const fieldId = getFieldId(field);

      if (
        !Object.prototype.hasOwnProperty.call(
          state.fieldW[index.id],
          fieldId
        )
      ) {
        state.fieldW[index.id][fieldId] = 1;
      }

      const control = createSlider({
        id: `field-weight-${index.id}-${fieldId}`,
        label: getFieldLabel(field),
        value: state.fieldW[index.id][fieldId],
        min: 0,
        max: 2,
        step: 0.1,
        onInput: function (value) {
          state.fieldW[index.id][fieldId] = value;
          recalculate();
        }
      });

      section.appendChild(control);
    }

    fieldWeightsDiv.appendChild(section);
  }
}


// =====================================================
// FUTURE VOLUME FACTOR TOGGLE
// =====================================================

function setupFutureVolumeToggle() {
  let wrapper =
    document.getElementById("futureVolumeControl");

  /*
    Create the control automatically if it has not
    already been added to index.html.
  */

  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.id = "futureVolumeControl";
    wrapper.className =
      "control-row future-volume-control";

    wrapper.innerHTML = `
      <label for="futureVolumeToggle">
        <input
          type="checkbox"
          id="futureVolumeToggle"
          checked
        >
        Apply Future Volume Factor
      </label>
      <span id="futureVolumeStatus">On</span>
    `;

    const preferredParent =
      indexWeightsDiv?.parentElement ??
      document.querySelector(".controls") ??
      document.querySelector("aside") ??
      document.body;

    if (indexWeightsDiv) {
      preferredParent.insertBefore(
        wrapper,
        indexWeightsDiv
      );
    } else {
      preferredParent.appendChild(wrapper);
    }
  }

  const toggle =
    document.getElementById("futureVolumeToggle");

  const status =
    document.getElementById("futureVolumeStatus");

  if (!toggle) {
    return;
  }

  toggle.checked =
    state.useFutureVolumeFactor;

  if (status) {
    status.textContent =
      toggle.checked ? "On" : "Off";
  }

  toggle.addEventListener("change", function () {
    state.useFutureVolumeFactor =
      toggle.checked;

    if (status) {
      status.textContent =
        toggle.checked ? "On" : "Off";
    }

    recalculate();
  });
}


// =====================================================
// RESET EQUAL WEIGHTS
// =====================================================

function setupResetButton() {
  const resetButton =
    document.getElementById("resetWeights") ??
    document.getElementById("resetEqualWeights");

  if (!resetButton) {
    return;
  }

  resetButton.addEventListener("click", function () {
    for (const index of state.indices) {
      state.indexW[index.id] = 1;

      if (!state.fieldW[index.id]) {
        state.fieldW[index.id] = {};
      }

      for (const field of index.fields || []) {
        state.fieldW[index.id][getFieldId(field)] = 1;
      }
    }

    buildIndexControls();
    buildFieldControls();
    recalculate();
  });
}


// =====================================================
// OPTIONAL BASEMAP CONTROLS
// =====================================================

function setupBasemapControls() {
  const shiftX =
    document.getElementById("basemapShiftX");

  const shiftY =
    document.getElementById("basemapShiftY");

  const shiftXValue =
    document.getElementById("basemapShiftXValue");

  const shiftYValue =
    document.getElementById("basemapShiftYValue");

  if (shiftX) {
    shiftX.value =
      String(DISPLAY.basemapShiftX);

    if (shiftXValue) {
      shiftXValue.textContent =
        `${DISPLAY.basemapShiftX}px`;
    }

    shiftX.addEventListener("input", function () {
      DISPLAY.basemapShiftX =
        safeNumber(shiftX.value, 0);

      if (shiftXValue) {
        shiftXValue.textContent =
          `${DISPLAY.basemapShiftX}px`;
      }

      draw();
    });
  }

  if (shiftY) {
    shiftY.value =
      String(DISPLAY.basemapShiftY);

    if (shiftYValue) {
      shiftYValue.textContent =
        `${DISPLAY.basemapShiftY}px`;
    }

    shiftY.addEventListener("input", function () {
      DISPLAY.basemapShiftY =
        safeNumber(shiftY.value, -7);

      if (shiftYValue) {
        shiftYValue.textContent =
          `${DISPLAY.basemapShiftY}px`;
      }

      draw();
    });
  }
}


// =====================================================
// OPTIONAL LINE-WIDTH CONTROL
// =====================================================

function setupLineWidthControl() {
  const lineWidthSlider =
    document.getElementById("lineWidth");

  const lineWidthValue =
    document.getElementById("lineWidthValue");

  if (!lineWidthSlider) {
    return;
  }

  lineWidthSlider.value =
    String(DISPLAY.lineWidth);

  if (lineWidthValue) {
    lineWidthValue.textContent =
      `${DISPLAY.lineWidth}px`;
  }

  lineWidthSlider.addEventListener(
    "input",
    function () {
      DISPLAY.lineWidth = Math.max(
        1,
        safeNumber(lineWidthSlider.value, 8)
      );

      if (lineWidthValue) {
        lineWidthValue.textContent =
          `${DISPLAY.lineWidth}px`;
      }

      draw();
    }
  );
}


// =====================================================
// LOAD APPLICATION DATA
// =====================================================

async function loadData() {
  if (statusEl) {
    statusEl.textContent =
      "Loading roadway segments and index data...";
  }

  try {
    const [segmentResponse, indexResponse] =
      await Promise.all([
        fetch("segments.json"),
        fetch("indices.json")
      ]);

    if (!segmentResponse.ok) {
      throw new Error(
        `segments.json returned ${segmentResponse.status}`
      );
    }

    if (!indexResponse.ok) {
      throw new Error(
        `indices.json returned ${indexResponse.status}`
      );
    }

    const segmentData =
      await segmentResponse.json();

    const indexData =
      await indexResponse.json();

    state.segments = Array.isArray(segmentData)
      ? segmentData
      : segmentData.segments ?? [];

    state.indices = Array.isArray(indexData)
      ? indexData
      : indexData.indices ?? [];

    for (const index of state.indices) {
      if (!index.id) {
        index.id =
          index.name ??
          index.label ??
          `index-${state.indices.indexOf(index)}`;
      }

      state.indexW[index.id] = 1;
      state.fieldW[index.id] = {};

      for (const field of index.fields || []) {
        state.fieldW[index.id][getFieldId(field)] = 1;
      }
    }

    buildIndexControls();
    buildFieldControls();

    setupFutureVolumeToggle();
    setupResetButton();
    setupBasemapControls();
    setupLineWidthControl();

    recalculate();

    if (statusEl) {
      statusEl.textContent =
        `${state.segments.length} roadway segments loaded. Future Volume Factor on.`;
    }
  } catch (error) {
    console.error(error);

    if (statusEl) {
      statusEl.textContent =
        `Unable to load the app data: ${error.message}`;
    }
  }
}


// =====================================================
// START APPLICATION
// =====================================================

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
loadData();

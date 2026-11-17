// =====================================================
// US 83 NEED INDEX EXPLORER
// VERSION 5.2
// =====================================================

console.log(
    "US 83 Need Index Explorer version 5.2"
);

// =====================================================
// MAP EXTENT
// =====================================================

const EXT = {
    west: -103.356215,
    east: -96.940124,
    south: 25.684963,
    north: 36.796656
};

// Raw GitHub URL for the basemap image.
const BASEMAP =
    "https://raw.githubusercontent.com/JSMITHHDR/US-83/5165469a29e097b35ddc90d6901b971ff3d13df0/State%20Narrow.png";

// =====================================================
// FIXED DISPLAY SETTINGS
// =====================================================

const DISPLAY = {
    // Horizontal basemap adjustment.
    basemapShiftX: 0,

    // Negative values move the basemap upward.
    basemapShiftY: -7,

    // Fixed line thickness.
    lineWidth: 8
};

// =====================================================
// FIXED COLOR RANGES
// =====================================================

/*
The colors represent fixed combined Need Index ranges.

These ranges do not change when the sliders move:

0.00 through 0.25 = Green
Greater than 0.25 through 0.50 = Yellow
Greater than 0.50 through 0.75 = Orange
Greater than 0.75 = Red
*/

const COLOR_CLASSES = [
    {
        minimum: 0.00,
        maximum: 0.25,
        label: "0.00 - 0.25",
        color: "#38A800"
    },
    {
        minimum: 0.25,
        maximum: 0.50,
        label: "&gt;0.25 - 0.50",
        color: "#FFFF00"
    },
    {
        minimum: 0.50,
        maximum: 0.75,
        label: "&gt;0.50 - 0.75",
        color: "#E69800"
    },
    {
        minimum: 0.75,
        maximum: Infinity,
        label: "&gt;0.75",
        color: "#FF0000"
    }
];

// =====================================================
// APPLICATION STATE
// =====================================================

const state = {
    segments: [],
    indices: [],

    // Final combined Need Index by Segment ID.
    scores: new Map(),

    // Fixed color-class assignment by Segment ID.
    colorClasses: new Map(),

    // Main index-level slider weights.
    indexW: {},

    // Individual field slider weights.
    fieldW: {},

    // Controls whether the Future Volume Factor is used.
    useFutureVolumeFactor: true
};

// =====================================================
// DOM REFERENCES
// =====================================================

const canvas =
    document.getElementById(
        "map"
    );

const ctx =
    canvas.getContext(
        "2d"
    );

const statusEl =
    document.getElementById(
        "status"
    );

const indexWeightsDiv =
    document.getElementById(
        "indexWeights"
    );

const fieldWeightsDiv =
    document.getElementById(
        "fieldWeights"
    );

const resetButton =
    document.getElementById(
        "reset"
    );

// =====================================================
// BASEMAP
// =====================================================

const basemap =
    new Image();

basemap.crossOrigin =
    "anonymous";

basemap.src =
    BASEMAP;

basemap.onload =
    draw;

basemap.onerror = function ()
{
    statusEl.textContent +=
        " Basemap could not load. Verify that the GitHub image is publicly accessible.";

    draw();
};

// =====================================================
// ASPECT-PRESERVING MAP FRAME
// =====================================================

function mapFrame()
{
    const canvasWidth =
        canvas.clientWidth;

    const canvasHeight =
        canvas.clientHeight;

    const extentWidth =
        EXT.east
        - EXT.west;

    const extentHeight =
        EXT.north
        - EXT.south;

    /*
    Use one common scale for both dimensions.

    This keeps the basemap and linework from being
    independently stretched.
    */

    const scale =
        Math.min(
            canvasWidth / extentWidth,
            canvasHeight / extentHeight
        );

    const drawWidth =
        extentWidth
        * scale;

    const drawHeight =
        extentHeight
        * scale;

    return {
        x:
            (
                canvasWidth
                - drawWidth
            )
            / 2,

        y:
            (
                canvasHeight
                - drawHeight
            )
            / 2,

        width:
            drawWidth,

        height:
            drawHeight,

        scale:
            scale
    };
}

// =====================================================
// PROJECT LONGITUDE AND LATITUDE
// =====================================================

function project(
    longitude,
    latitude
)
{
    const frame =
        mapFrame();

    const x =
        frame.x
        +
        (
            longitude
            - EXT.west
        )
        * frame.scale;

    const y =
        frame.y
        +
        (
            EXT.north
            - latitude
        )
        * frame.scale;

    return [
        x,
        y
    ];
}

// =====================================================
// TOTAL ACTIVE INDEX WEIGHT
// =====================================================

function activeIndexWeightTotal()
{
    return state.indices.reduce(
        function (
            total,
            index
        )
        {
            const weight =
                Number(
                    state.indexW[
                        index.id
                    ]
                    ?? 0
                );

            return total
                + Math.max(
                    0,
                    weight
                );
        },
        0
    );
}

// =====================================================
// SAFE NUMERIC VALUE
// =====================================================

/*
This reproduces the Excel expression:

IF(cell="",0,cell)

Blank, missing, and nonnumeric values become zero.
*/

function safeNumber(
    value
)
{
    if (
        value === null
        ||
        value === undefined
        ||
        value === ""
    )
    {
        return 0;
    }

    const numericValue =
        Number(value);

    return Number.isFinite(
        numericValue
    )
        ? numericValue
        : 0;
}

// =====================================================
// RAW SCORE FOR ONE SEGMENT AND ONE INDEX
// =====================================================

/*
When the Future Volume Factor toggle is on, this reproduces:

(
    Field1 * Weight1
    + Field2 * Weight2
    + ...
)
* FutureVolumeFactor

When the toggle is off, it reproduces:

(
    Field1 * Weight1
    + Field2 * Weight2
    + ...
)

The weighted fields are summed directly.

The script does not divide by the sum of the field weights,
and it does not normalize the individual fields.
*/

function calculateRawIndexScore(
    row,
    index
)
{
    let weightedFieldTotal = 0;

    index.fields.forEach(
        function (field)
        {
            const fieldValue =
                safeNumber(
                    row.values[
                        field
                    ]
                );

            const fieldWeight =
                safeNumber(
                    state.fieldW[
                        index.id
                    ]?.[field]
                    ?? 0
                );

            weightedFieldTotal +=
                fieldValue
                * fieldWeight;
        }
    );

    if (
        !state.useFutureVolumeFactor
    )
    {
        return weightedFieldTotal;
    }

    const futureVolumeFactor =
        safeNumber(
            row.futureVolumeFactor
        );

    return weightedFieldTotal
        * futureVolumeFactor;
}

// =====================================================
// NORMALIZE ONE INDEX AGAINST ITS PEAK
// =====================================================

/*
This reproduces the spreadsheet logic:

peak = MAX(scores)

normalized score =
    IF(
        peak = 0,
        0,
        segment raw score / peak
    )

Each index is normalized independently.
*/

function calculateNormalizedIndexScores(
    index
)
{
    const rawScores =
        new Map();

    let peakScore = 0;

    // First pass: calculate raw scores and find the peak.
    state.segments.forEach(
        function (segment)
        {
            const row =
                index.rows[
                    segment.segmentId
                ];

            const rawScore =
                row
                    ? calculateRawIndexScore(
                        row,
                        index
                    )
                    : 0;

            rawScores.set(
                segment.segmentId,
                rawScore
            );

            peakScore =
                Math.max(
                    peakScore,
                    rawScore
                );
        }
    );

    const normalizedScores =
        new Map();

    // Second pass: divide each raw score by the peak.
    state.segments.forEach(
        function (segment)
        {
            const rawScore =
                rawScores.get(
                    segment.segmentId
                )
                ?? 0;

            const normalizedScore =
                peakScore === 0
                    ? 0
                    : rawScore
                        / peakScore;

            normalizedScores.set(
                segment.segmentId,
                normalizedScore
            );
        }
    );

    return {
        peak:
            peakScore,

        scores:
            normalizedScores
    };
}

// =====================================================
// GET FIXED COLOR CLASS
// =====================================================

function getFixedColorClass(
    score
)
{
    /*
    Explicit boundary handling:

    0.25 stays green.
    0.50 stays yellow.
    0.75 stays orange.
    Values above 0.75 are red.
    */

    if (score <= 0.25)
    {
        return 0;
    }

    if (score <= 0.50)
    {
        return 1;
    }

    if (score <= 0.75)
    {
        return 2;
    }

    return 3;
}

function getFixedColor(
    score
)
{
    const classNumber =
        getFixedColorClass(
            score
        );

    return COLOR_CLASSES[
        classNumber
    ].color;
}

// =====================================================
// ASSIGN FIXED COLOR CLASSES
// =====================================================

function assignFixedColorClasses()
{
    state.colorClasses.clear();

    state.scores.forEach(
        function (
            score,
            segmentId
        )
        {
            if (
                !Number.isFinite(
                    score
                )
            )
            {
                return;
            }

            const classNumber =
                getFixedColorClass(
                    score
                );

            state.colorClasses.set(
                segmentId,
                classNumber
            );
        }
    );
}

// =====================================================
// RECALCULATE ALL NEED INDEX SCORES
// =====================================================

function recalculateScores()
{
    state.scores.clear();
    state.colorClasses.clear();

    /*
    If every main index slider is zero, stop immediately.

    No lines are created or assigned a default green color.
    */

    if (
        activeIndexWeightTotal() <= 0
    )
    {
        statusEl.textContent =
            "All index weights are zero. No lines are displayed.";

        draw();
        return;
    }

    /*
    Calculate each individual index using the supplied
    spreadsheet methodology.
    */

    const normalizedIndexResults =
        {};

    state.indices.forEach(
        function (index)
        {
            normalizedIndexResults[
                index.id
            ] =
                calculateNormalizedIndexScores(
                    index
                );
        }
    );

    /*
    Combine the normalized indexes using the main
    index-level slider weights.
    */

    state.segments.forEach(
        function (segment)
        {
            let combinedWeightedTotal = 0;
            let combinedWeightTotal = 0;

            state.indices.forEach(
                function (index)
                {
                    const indexWeight =
                        safeNumber(
                            state.indexW[
                                index.id
                            ]
                            ?? 0
                        );

                    if (indexWeight <= 0)
                    {
                        return;
                    }

                    const normalizedScore =
                        normalizedIndexResults[
                            index.id
                        ].scores.get(
                            segment.segmentId
                        )
                        ?? 0;

                    combinedWeightedTotal +=
                        normalizedScore
                        * indexWeight;

                    combinedWeightTotal +=
                        indexWeight;
                }
            );

            if (combinedWeightTotal <= 0)
            {
                return;
            }

            /*
            Divide by total active index weight so only the
            relative weighting of the indexes matters.
            */

            const combinedScore =
                combinedWeightedTotal
                / combinedWeightTotal;

            state.scores.set(
                segment.segmentId,
                combinedScore
            );
        }
    );

    assignFixedColorClasses();
    updateStatusMessage();
    draw();
}

// =====================================================
// UPDATE STATUS MESSAGE
// =====================================================

function updateStatusMessage()
{
    const classCounts =
        [
            0,
            0,
            0,
            0
        ];

    state.colorClasses.forEach(
        function (classNumber)
        {
            classCounts[
                classNumber
            ] += 1;
        }
    );

    statusEl.textContent =
        `${state.scores.size} scored segments: `
        + `${classCounts[0]} green, `
        + `${classCounts[1]} yellow, `
        + `${classCounts[2]} orange, `
        + `${classCounts[3]} red.`;
}

// =====================================================
// CREATE WEIGHT SLIDER WITH EDITABLE NUMBER BOX
// =====================================================

function createWeightSlider(
    labelText,
    changeFunction
)
{
    const minimumValue = 0;
    const maximumValue = 5;
    const stepValue = 0.1;
    const defaultValue = 1;

    const container =
        document.createElement(
            "div"
        );

    container.className =
        "slider";

    const label =
        document.createElement(
            "label"
        );

    const labelName =
        document.createElement(
            "span"
        );

    labelName.textContent =
        labelText;

    /*
    Create an editable number input instead of the
    previous read-only output element.

    Users can type a weight directly into this box.
    */

    const numberInput =
        document.createElement(
            "input"
        );

    numberInput.type =
        "number";

    numberInput.className =
        "weight-number";

    numberInput.min =
        String(
            minimumValue
        );

    numberInput.max =
        String(
            maximumValue
        );

    numberInput.step =
        String(
            stepValue
        );

    numberInput.value =
        defaultValue.toFixed(
            1
        );

    numberInput.setAttribute(
        "aria-label",
        labelText + " weight"
    );

    label.appendChild(
        labelName
    );

    label.appendChild(
        numberInput
    );

    const rangeInput =
        document.createElement(
            "input"
        );

    rangeInput.type =
        "range";

    rangeInput.min =
        String(
            minimumValue
        );

    rangeInput.max =
        String(
            maximumValue
        );

    rangeInput.step =
        String(
            stepValue
        );

    rangeInput.value =
        String(
            defaultValue
        );

    rangeInput.setAttribute(
        "aria-label",
        labelText + " slider"
    );

    /*
    Keeps values within the accepted 0 through 5 range.
    Values are rounded to the nearest tenth.
    */

    function normalizeWeight(
        value
    )
    {
        const numericValue =
            Number(
                value
            );

        if (
            !Number.isFinite(
                numericValue
            )
        )
        {
            return null;
        }

        const limitedValue =
            Math.min(
                maximumValue,
                Math.max(
                    minimumValue,
                    numericValue
                )
            );

        const roundedValue =
            Math.round(
                limitedValue
                / stepValue
            )
            * stepValue;

        return Number(
            roundedValue.toFixed(
                1
            )
        );
    }

    /*
    Updates both controls and recalculates the map.
    */

    function applyWeight(
        value
    )
    {
        const normalizedValue =
            normalizeWeight(
                value
            );

        if (
            normalizedValue === null
        )
        {
            return;
        }

        rangeInput.value =
            String(
                normalizedValue
            );

        numberInput.value =
            normalizedValue.toFixed(
                1
            );

        changeFunction(
            normalizedValue
        );
    }

    /*
    Moving the slider updates the number box.
    */

    rangeInput.addEventListener(
        "input",
        function ()
        {
            applyWeight(
                rangeInput.value
            );
        }
    );

    /*
    Typing in the number box updates the slider.

    The input event makes the map respond immediately
    once the entered value is valid.
    */

    numberInput.addEventListener(
        "input",
        function ()
        {
            if (
                numberInput.value === ""
                ||
                numberInput.value === "-"
                ||
                numberInput.value === "."
            )
            {
                return;
            }

            const normalizedValue =
                normalizeWeight(
                    numberInput.value
                );

            if (
                normalizedValue === null
            )
            {
                return;
            }

            rangeInput.value =
                String(
                    normalizedValue
                );

            changeFunction(
                normalizedValue
            );
        }
    );

    /*
    When the user leaves the number box, clamp the
    value to 0 through 5 and format it to one decimal.
    */

    numberInput.addEventListener(
        "change",
        function ()
        {
            if (
                numberInput.value.trim() === ""
            )
            {
                applyWeight(
                    defaultValue
                );

                return;
            }

            applyWeight(
                numberInput.value
            );
        }
    );

    /*
    Pressing Enter applies the entered number and
    removes focus from the box.
    */

    numberInput.addEventListener(
        "keydown",
        function (event)
        {
            if (
                event.key === "Enter"
            )
            {
                event.preventDefault();

                applyWeight(
                    numberInput.value
                );

                numberInput.blur();
            }
        }
    );

    container.appendChild(
        label
    );

    container.appendChild(
        rangeInput
    );

    return container;
}
// =====================================================
// BUILD INDEX AND FIELD WEIGHT CONTROLS
// =====================================================

function buildWeightControls()
{
    indexWeightsDiv.innerHTML =
        "";

    fieldWeightsDiv.innerHTML =
        "";

    state.indices.forEach(
        function (index)
        {
            // Equal default index weight.
            state.indexW[
                index.id
            ] =
                1;

            state.fieldW[
                index.id
            ] =
                {};

            const indexSlider =
                createWeightSlider(
                    index.name,
                    function (value)
                    {
                        state.indexW[
                            index.id
                        ] =
                            value;

                        recalculateScores();
                    }
                );

            indexWeightsDiv.appendChild(
                indexSlider
            );

            // Expandable field controls.
            const details =
                document.createElement(
                    "details"
                );

            const summary =
                document.createElement(
                    "summary"
                );

            summary.textContent =
                index.name;

            details.appendChild(
                summary
            );

            index.fields.forEach(
                function (field)
                {
                    // Equal default field weight.
                    state.fieldW[
                        index.id
                    ][field] =
                        1;

                    const fieldSlider =
                        createWeightSlider(
                            field,
                            function (value)
                            {
                                state.fieldW[
                                    index.id
                                ][field] =
                                    value;

                                recalculateScores();
                            }
                        );

                    details.appendChild(
                        fieldSlider
                    );
                }
            );

            fieldWeightsDiv.appendChild(
                details
            );
        }
    );
}

// =====================================================
// BUILD FUTURE VOLUME FACTOR TOGGLE
// =====================================================

function buildFutureVolumeToggle()
{
    const container =
        document.createElement(
            "div"
        );

    container.className =
        "slider";

    const label =
        document.createElement(
            "label"
        );

    const labelName =
        document.createElement(
            "span"
        );

    labelName.textContent =
        "Apply Future Volume Factor";

    const input =
        document.createElement(
            "input"
        );

    input.type =
        "checkbox";

    input.id =
        "futureVolumeToggle";

    input.checked =
        state.useFutureVolumeFactor;

    input.addEventListener(
        "change",
        function ()
        {
            state.useFutureVolumeFactor =
                input.checked;

            recalculateScores();
        }
    );

    label.appendChild(
        labelName
    );

    label.appendChild(
        input
    );

    container.appendChild(
        label
    );

    if (
        resetButton
        &&
        resetButton.parentNode
    )
    {
        resetButton.parentNode.insertBefore(
            container,
            resetButton
        );
    }
}

// =====================================================
// RESIZE CANVAS
// =====================================================

function resizeCanvas()
{
    const pixelRatio =
        window.devicePixelRatio
        || 1;

    const displayWidth =
        canvas.clientWidth;

    const displayHeight =
        canvas.clientHeight;

    const requiredWidth =
        Math.round(
            displayWidth
            * pixelRatio
        );

    const requiredHeight =
        Math.round(
            displayHeight
            * pixelRatio
        );

    if (
        canvas.width !== requiredWidth
        ||
        canvas.height !== requiredHeight
    )
    {
        canvas.width =
            requiredWidth;

        canvas.height =
            requiredHeight;
    }

    ctx.setTransform(
        pixelRatio,
        0,
        0,
        pixelRatio,
        0,
        0
    );

    draw();
}

// =====================================================
// CREATE SEGMENT PATH
// =====================================================

function createSegmentPath(
    segment
)
{
    ctx.beginPath();

    segment.coordinates.forEach(
        function (
            coordinate,
            coordinateIndex
        )
        {
            const point =
                project(
                    coordinate[0],
                    coordinate[1]
                );

            if (coordinateIndex === 0)
            {
                ctx.moveTo(
                    point[0],
                    point[1]
                );
            }
            else
            {
                ctx.lineTo(
                    point[0],
                    point[1]
                );
            }
        }
    );
}

// =====================================================
// DRAW MAP
// =====================================================

function draw()
{
    const width =
        canvas.clientWidth;

    const height =
        canvas.clientHeight;

    ctx.clearRect(
        0,
        0,
        width,
        height
    );

    ctx.fillStyle =
        "#d7dde4";

    ctx.fillRect(
        0,
        0,
        width,
        height
    );

    const frame =
        mapFrame();

    /*
    Draw the basemap with the fixed -7 pixel vertical
    adjustment. Linework remains fixed.
    */

    if (
        basemap.complete
        &&
        basemap.naturalWidth > 0
    )
    {
        ctx.drawImage(
            basemap,

            frame.x
                + DISPLAY.basemapShiftX,

            frame.y
                + DISPLAY.basemapShiftY,

            frame.width,
            frame.height
        );
    }

    /*
    Do not draw any roadway lines when all main index
    sliders are zero.
    */

    if (
        state.indices.length > 0
        &&
        activeIndexWeightTotal() <= 0
    )
    {
        return;
    }

    ctx.lineCap =
        "round";

    ctx.lineJoin =
        "round";

    state.segments.forEach(
        function (segment)
        {
            if (
                !state.scores.has(
                    segment.segmentId
                )
                ||
                !state.colorClasses.has(
                    segment.segmentId
                )
            )
            {
                return;
            }

            const score =
                state.scores.get(
                    segment.segmentId
                );

            createSegmentPath(
                segment
            );

            /*
            Use one colored stroke only.

            No casing or outline is applied.
            */

            ctx.strokeStyle =
                getFixedColor(
                    score
                );

            ctx.lineWidth =
                DISPLAY.lineWidth;

            ctx.stroke();
        }
    );
}

// =====================================================
// LOAD DATA
// =====================================================

Promise.all([
    fetch(
        "segments.json"
    )
    .then(
        function (response)
        {
            if (!response.ok)
            {
                throw new Error(
                    "Could not load segments.json"
                );
            }

            return response.json();
        }
    ),

    fetch(
        "indices.json"
    )
    .then(
        function (response)
        {
            if (!response.ok)
            {
                throw new Error(
                    "Could not load indices.json"
                );
            }

            return response.json();
        }
    )
])
.then(
    function (results)
    {
        state.segments =
            results[0];

        state.indices =
            results[1];

        buildWeightControls();
        buildFutureVolumeToggle();
        recalculateScores();
        resizeCanvas();
    }
)
.catch(
    function (error)
    {
        console.error(
            "DATA LOAD ERROR:",
            error
        );

        statusEl.textContent =
            "The map data could not be loaded. "
            + "Confirm that segments.json and indices.json "
            + "are in the same GitHub folder as app.js.";
    }
);

// =====================================================
// RESET WEIGHTS
// =====================================================

resetButton.addEventListener(
    "click",
    function ()
    {
        window.location.reload();
    }
);

// =====================================================
// WINDOW RESIZE
// =====================================================

window.addEventListener(
    "resize",
    resizeCanvas
);

// Initial canvas sizing.
resizeCanvas();

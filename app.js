// =====================================================
// US 83 NEED INDEX EXPLORER
// VERSION 5.6
// =====================================================

console.log("US 83 Need Index Explorer version 5.6");

// =====================================================
// MAP EXTENT
// =====================================================

const EXT = {
    west: -102.923583,
    east: -97.065799,
    south: 25.393838,
    north: 37.282022
};

// =====================================================
// MAP IMAGE URLS
// =====================================================

const BASEMAP =
    "https://raw.githubusercontent.com/JSMITHHDR/US-83/9e27d6862f0ff6a41d1b07dd8c6b9544a0e217e5/Texas%20with%20Study%20Area%20Narrow.png";

const LABELS_OVERLAY =
    "https://raw.githubusercontent.com/JSMITHHDR/US-83/d957daa12aee5b111ba4beebb137cbebac62d6ef/Labels.png";

// =====================================================
// FIXED DISPLAY SETTINGS
// =====================================================

const DISPLAY = {
    /*
    Fixed basemap and labels position.

    Negative Shift X moves the images left.
    Positive Shift X moves the images right.

    Negative Shift Y moves the images upward.
    Positive Shift Y moves the images downward.
    */

    basemapShiftX: 0,
    basemapShiftY: 0,

    /*
    Fixed image scale.

    1.000 = original size
    Less than 1.000 = smaller
    Greater than 1.000 = larger
    */

    basemapScaleX: 1.000,
    basemapScaleY: 1.000,

    // Fixed roadway line thickness in pixels.
    lineWidth: 8
};

// =====================================================
// COLOR AND CLASSIFICATION SETTINGS
// =====================================================

const COLOR_CLASSES = [
    {
        label: "Class 1",
        color: "#38A800"
    },
    {
        label: "Class 2",
        color: "#FFFF00"
    },
    {
        label: "Class 3",
        color: "#E69800"
    },
    {
        label: "Class 4",
        color: "#FF0000"
    }
];

const CLASSIFICATION_METHODS = {
    equalInterval: "equalInterval",
    standardDeviation: "standardDeviation"
};

// =====================================================
// WEIGHT SETTINGS
// =====================================================

const WEIGHT_SETTINGS = {
    minimum: 0,
    maximum: 5,
    step: 0.1,
    defaultValue: 1
};

// =====================================================
// APPLICATION STATE
// =====================================================

const state = {
    segments: [],
    indices: [],

    // Final combined Need Index by Segment ID.
    scores: new Map(),

    // Current color class by Segment ID.
    colorClasses: new Map(),

    // Main index-level weights.
    indexW: {},

    // Individual field weights.
    fieldW: {},

    // Controls whether Future Volume Factor is applied.
    useFutureVolumeFactor: true,

    // Current classification method.
    classificationMethod:
        CLASSIFICATION_METHODS.equalInterval,

    // Three boundaries used to create four classes.
    classBreaks: [],

    // Statistics for the current combined scores.
    classificationStatistics: {
        minimum: 0,
        maximum: 0,
        mean: 0,
        standardDeviation: 0
    }
};

// =====================================================
// DOM REFERENCES
// =====================================================

const canvas =
    document.getElementById("map");

const ctx =
    canvas.getContext("2d");

const statusEl =
    document.getElementById("status");

const indexWeightsDiv =
    document.getElementById("indexWeights");

const fieldWeightsDiv =
    document.getElementById("fieldWeights");

const resetButton =
    document.getElementById("reset");

// =====================================================
// LOAD BASEMAP
// =====================================================

const basemap =
    new Image();

basemap.crossOrigin =
    "anonymous";

basemap.src =
    BASEMAP;

basemap.onload =
    draw;

basemap.onerror =
    function ()
    {
        console.error(
            "Basemap could not load:",
            BASEMAP
        );

        if (statusEl)
        {
            statusEl.textContent +=
                " The basemap could not be loaded.";
        }

        draw();
    };

// =====================================================
// LOAD LABELS OVERLAY
// =====================================================

const labelsOverlay =
    new Image();

labelsOverlay.crossOrigin =
    "anonymous";

labelsOverlay.src =
    LABELS_OVERLAY;

labelsOverlay.onload =
    draw;

labelsOverlay.onerror =
    function ()
    {
        console.error(
            "Labels overlay could not load:",
            LABELS_OVERLAY
        );

        if (statusEl)
        {
            statusEl.textContent +=
                " The labels overlay could not be loaded.";
        }

        draw();
    };

// =====================================================
// MAP FRAME
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
    Use one common scale for both dimensions so the
    map is not stretched independently.
    */

    const scale =
        Math.min(
            canvasWidth / extentWidth,
            canvasHeight / extentHeight
        );

    const width =
        extentWidth
        * scale;

    const height =
        extentHeight
        * scale;

    return {
        x:
            (
                canvasWidth
                - width
            )
            / 2,

        y:
            (
                canvasHeight
                - height
            )
            / 2,

        width:
            width,

        height:
            height,

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
// FIXED BASEMAP AND LABELS FRAME
// =====================================================

function adjustedBasemapFrame()
{
    const frame =
        mapFrame();

    const width =
        frame.width
        * DISPLAY.basemapScaleX;

    const height =
        frame.height
        * DISPLAY.basemapScaleY;

    /*
    Scale around the middle of the original image frame,
    then apply the fixed horizontal and vertical shifts.
    */

    const x =
        frame.x
        -
        (
            width
            - frame.width
        )
        / 2
        +
        DISPLAY.basemapShiftX;

    const y =
        frame.y
        -
        (
            height
            - frame.height
        )
        / 2
        +
        DISPLAY.basemapShiftY;

    return {
        x:
            x,

        y:
            y,

        width:
            width,

        height:
            height
    };
}

// =====================================================
// ACTIVE INDEX WEIGHT TOTAL
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
        Number(
            value
        );

    return Number.isFinite(
        numericValue
    )
        ? numericValue
        : 0;
}

// =====================================================
// RAW SCORE FOR ONE SEGMENT AND ONE INDEX
// =====================================================

function calculateRawIndexScore(
    row,
    index
)
{
    let weightedFieldTotal =
        0;

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

function calculateNormalizedIndexScores(
    index
)
{
    const rawScores =
        new Map();

    let peakScore =
        0;

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
// RECALCULATE ALL NEED INDEX SCORES
// =====================================================

function recalculateScores()
{
    state.scores.clear();
    state.colorClasses.clear();
    state.classBreaks = [];

    /*
    When all main index weights are zero, no roadway
    lines are displayed.
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
    Combine normalized index scores using the main
    index-level weights.
    */

    state.segments.forEach(
        function (segment)
        {
            let combinedWeightedTotal =
                0;

            let combinedWeightTotal =
                0;

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

                    if (
                        indexWeight <= 0
                    )
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

            if (
                combinedWeightTotal <= 0
            )
            {
                return;
            }

            const combinedScore =
                combinedWeightedTotal
                / combinedWeightTotal;

            state.scores.set(
                segment.segmentId,
                combinedScore
            );
        }
    );

    assignColorClasses();
    updateStatusMessage();
    draw();
}

// =====================================================
// GET FINITE SCORES
// =====================================================

function getFiniteScores()
{
    return Array.from(
        state.scores.values()
    ).filter(
        function (score)
        {
            return Number.isFinite(
                score
            );
        }
    );
}

// =====================================================
// CALCULATE SCORE STATISTICS
// =====================================================

function calculateScoreStatistics(
    scores
)
{
    if (
        scores.length === 0
    )
    {
        return {
            minimum: 0,
            maximum: 0,
            mean: 0,
            standardDeviation: 0
        };
    }

    const minimum =
        Math.min(
            ...scores
        );

    const maximum =
        Math.max(
            ...scores
        );

    const total =
        scores.reduce(
            function (
                sum,
                score
            )
            {
                return sum
                    + score;
            },
            0
        );

    const mean =
        total
        / scores.length;

    /*
    Population standard deviation is used because the
    displayed corridor segments are treated as the
    complete analysis set.
    */

    const variance =
        scores.reduce(
            function (
                sum,
                score
            )
            {
                const difference =
                    score
                    - mean;

                return sum
                    +
                    difference
                    * difference;
            },
            0
        )
        / scores.length;

    return {
        minimum:
            minimum,

        maximum:
            maximum,

        mean:
            mean,

        standardDeviation:
            Math.sqrt(
                variance
            )
    };
}

// =====================================================
// BUILD FOUR EQUAL-INTERVAL BREAKS
// =====================================================

function buildEqualIntervalBreaks(
    statistics
)
{
    const range =
        statistics.maximum
        - statistics.minimum;

    if (
        range <= 0
    )
    {
        return [
            statistics.maximum,
            statistics.maximum,
            statistics.maximum
        ];
    }

    const interval =
        range
        / 4;

    return [
        statistics.minimum
            + interval,

        statistics.minimum
            + interval
            * 2,

        statistics.minimum
            + interval
            * 3
    ];
}

// =====================================================
// BUILD STANDARD-DEVIATION BREAKS
// =====================================================

function buildStandardDeviationBreaks(
    statistics
)
{
    return [
        statistics.mean
            - statistics.standardDeviation,

        statistics.mean,

        statistics.mean
            + statistics.standardDeviation
    ];
}

// =====================================================
// CALCULATE CURRENT CLASS BREAKS
// =====================================================

function calculateClassBreaks()
{
    const scores =
        getFiniteScores();

    const statistics =
        calculateScoreStatistics(
            scores
        );

    state.classificationStatistics =
        statistics;

    if (
        state.classificationMethod
        ===
        CLASSIFICATION_METHODS.standardDeviation
    )
    {
        state.classBreaks =
            buildStandardDeviationBreaks(
                statistics
            );

        return;
    }

    state.classBreaks =
        buildEqualIntervalBreaks(
            statistics
        );
}

// =====================================================
// GET COLOR CLASS
// =====================================================

function getColorClass(
    score
)
{
    const break1 =
        state.classBreaks[0]
        ?? 0;

    const break2 =
        state.classBreaks[1]
        ?? break1;

    const break3 =
        state.classBreaks[2]
        ?? break2;

    if (
        score <= break1
    )
    {
        return 0;
    }

    if (
        score <= break2
    )
    {
        return 1;
    }

    if (
        score <= break3
    )
    {
        return 2;
    }

    return 3;
}

// =====================================================
// GET CLASS COLOR
// =====================================================

function getClassColor(
    score
)
{
    const classNumber =
        getColorClass(
            score
        );

    return COLOR_CLASSES[
        classNumber
    ].color;
}

// =====================================================
// ASSIGN COLOR CLASSES
// =====================================================

function assignColorClasses()
{
    state.colorClasses.clear();

    calculateClassBreaks();

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

            state.colorClasses.set(
                segmentId,
                getColorClass(
                    score
                )
            );
        }
    );
}

// =====================================================
// FORMAT CLASSIFICATION VALUE
// =====================================================

function formatClassificationValue(
    value
)
{
    if (
        !Number.isFinite(
            value
        )
    )
    {
        return "0.000";
    }

    return value.toFixed(
        3
    );
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

    const classificationName =
        state.classificationMethod
        ===
        CLASSIFICATION_METHODS.standardDeviation
            ? "Standard deviation"
            : "4 equal intervals";

    statusEl.textContent =
        `${state.scores.size} scored segments: `
        + `${classCounts[0]} green, `
        + `${classCounts[1]} yellow, `
        + `${classCounts[2]} orange, `
        + `${classCounts[3]} red. `
        + `${classificationName} breaks: `
        + `${formatClassificationValue(state.classBreaks[0])}, `
        + `${formatClassificationValue(state.classBreaks[1])}, and `
        + `${formatClassificationValue(state.classBreaks[2])}.`;
}

// =====================================================
// NORMALIZE ENTERED WEIGHT
// =====================================================

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

    const clampedValue =
        Math.min(
            WEIGHT_SETTINGS.maximum,

            Math.max(
                WEIGHT_SETTINGS.minimum,
                numericValue
            )
        );

    const roundedValue =
        Math.round(
            clampedValue
            / WEIGHT_SETTINGS.step
        )
        * WEIGHT_SETTINGS.step;

    return Number(
        roundedValue.toFixed(
            1
        )
    );
}

// =====================================================
// CREATE WEIGHT SLIDER WITH EDITABLE NUMBER BOX
// =====================================================

function createWeightSlider(
    labelText,
    changeFunction
)
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
        labelText;

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
            WEIGHT_SETTINGS.minimum
        );

    numberInput.max =
        String(
            WEIGHT_SETTINGS.maximum
        );

    numberInput.step =
        String(
            WEIGHT_SETTINGS.step
        );

    numberInput.value =
        WEIGHT_SETTINGS.defaultValue.toFixed(
            1
        );

    numberInput.setAttribute(
        "aria-label",
        labelText + " weight"
    );

    numberInput.setAttribute(
        "inputmode",
        "decimal"
    );

    const rangeInput =
        document.createElement(
            "input"
        );

    rangeInput.type =
        "range";

    rangeInput.min =
        String(
            WEIGHT_SETTINGS.minimum
        );

    rangeInput.max =
        String(
            WEIGHT_SETTINGS.maximum
        );

    rangeInput.step =
        String(
            WEIGHT_SETTINGS.step
        );

    rangeInput.value =
        String(
            WEIGHT_SETTINGS.defaultValue
        );

    rangeInput.setAttribute(
        "aria-label",
        labelText + " slider"
    );

    function applyWeight(
        value,
        formatNumberBox
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

        if (
            formatNumberBox
        )
        {
            numberInput.value =
                normalizedValue.toFixed(
                    1
                );
        }

        changeFunction(
            normalizedValue
        );
    }

    rangeInput.addEventListener(
        "input",
        function ()
        {
            numberInput.value =
                Number(
                    rangeInput.value
                ).toFixed(
                    1
                );

            applyWeight(
                rangeInput.value,
                false
            );
        }
    );

    numberInput.addEventListener(
        "input",
        function ()
        {
            if (
                numberInput.value.trim()
                === ""
            )
            {
                return;
            }

            applyWeight(
                numberInput.value,
                false
            );
        }
    );

    numberInput.addEventListener(
        "blur",
        function ()
        {
            if (
                numberInput.value.trim()
                === ""
                ||
                normalizeWeight(
                    numberInput.value
                )
                === null
            )
            {
                numberInput.value =
                    Number(
                        rangeInput.value
                    ).toFixed(
                        1
                    );

                return;
            }

            applyWeight(
                numberInput.value,
                true
            );
        }
    );

    numberInput.addEventListener(
        "keydown",
        function (event)
        {
            if (
                event.key !== "Enter"
            )
            {
                return;
            }

            event.preventDefault();

            applyWeight(
                numberInput.value
                || rangeInput.value,
                true
            );

            numberInput.blur();
        }
    );

    label.appendChild(
        labelName
    );

    label.appendChild(
        numberInput
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
            state.indexW[
                index.id
            ] =
                WEIGHT_SETTINGS.defaultValue;

            state.fieldW[
                index.id
            ] =
                {};

            const indexControl =
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
                indexControl
            );

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
                    state.fieldW[
                        index.id
                    ][field] =
                        WEIGHT_SETTINGS.defaultValue;

                    const fieldControl =
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
                        fieldControl
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
// INSERT CONTROL BEFORE RESET BUTTON
// =====================================================

function insertControlBeforeReset(
    control
)
{
    if (
        resetButton
        &&
        resetButton.parentNode
    )
    {
        resetButton.parentNode.insertBefore(
            control,
            resetButton
        );
    }
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
        "slider option-control";

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

    insertControlBeforeReset(
        container
    );
}

// =====================================================
// BUILD CLASSIFICATION METHOD SELECTOR
// =====================================================

function buildClassificationToggle()
{
    const container =
        document.createElement(
            "div"
        );

    container.className =
        "classification-control";

    const heading =
        document.createElement(
            "div"
        );

    heading.className =
        "classification-title";

    heading.textContent =
        "Classification Method";

    const options =
        document.createElement(
            "div"
        );

    options.className =
        "classification-options";

    function addClassificationOption(
        value,
        text,
        checked
    )
    {
        const label =
            document.createElement(
                "label"
            );

        const input =
            document.createElement(
                "input"
            );

        input.type =
            "radio";

        input.name =
            "classificationMethod";

        input.value =
            value;

        input.checked =
            checked;

        const labelText =
            document.createElement(
                "span"
            );

        labelText.textContent =
            text;

        input.addEventListener(
            "change",
            function ()
            {
                if (
                    !input.checked
                )
                {
                    return;
                }

                state.classificationMethod =
                    value;

                assignColorClasses();
                updateStatusMessage();
                draw();
            }
        );

        label.appendChild(
            input
        );

        label.appendChild(
            labelText
        );

        options.appendChild(
            label
        );
    }

    addClassificationOption(
        CLASSIFICATION_METHODS.equalInterval,
        "4 Equal Intervals",

        state.classificationMethod
        ===
        CLASSIFICATION_METHODS.equalInterval
    );

    addClassificationOption(
        CLASSIFICATION_METHODS.standardDeviation,
        "Standard Deviation",

        state.classificationMethod
        ===
        CLASSIFICATION_METHODS.standardDeviation
    );

    container.appendChild(
        heading
    );

    container.appendChild(
        options
    );

    insertControlBeforeReset(
        container
    );
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

            if (
                coordinateIndex === 0
            )
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
// DRAW IMAGE USING FIXED IMAGE FRAME
// =====================================================

function drawImageToAdjustedFrame(
    image
)
{
    if (
        !image.complete
        ||
        image.naturalWidth <= 0
    )
    {
        return;
    }

    const frame =
        adjustedBasemapFrame();

    ctx.drawImage(
        image,
        frame.x,
        frame.y,
        frame.width,
        frame.height
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

    /*
    Drawing order:

    1. Main basemap
    2. Scored roadway linework
    3. Transparent labels overlay
    */

    drawImageToAdjustedFrame(
        basemap
    );

    if (
        state.indices.length === 0
        ||
        activeIndexWeightTotal() > 0
    )
    {
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

                ctx.strokeStyle =
                    getClassColor(
                        score
                    );

                ctx.lineWidth =
                    DISPLAY.lineWidth;

                ctx.stroke();
            }
        );
    }

    /*
    Labels.png is drawn last so labels appear above the
    roadway linework. The image must have a transparent
    background.
    */

    drawImageToAdjustedFrame(
        labelsOverlay
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
            if (
                !response.ok
            )
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
            if (
                !response.ok
            )
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
        buildClassificationToggle();
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
// RESET APPLICATION
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

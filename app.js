// =====================================================
// US 83 NEED INDEX EXPLORER
// VERSION 5.4
// =====================================================

console.log(
    "US 83 Need Index Explorer version 5.4"
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
    "https://raw.githubusercontent.com/JSMITHHDR/US-83/a12a6ef617c4dc9167713261bd20994c956ec0ea/BasemapT1.png";

// =====================================================
// DISPLAY SETTINGS
// =====================================================

const DISPLAY = {
    /*
    Temporary basemap calibration values.

    Shift values are measured in screen pixels.

    Scale values are multipliers:
    1.000 = original size
    0.990 = 1 percent smaller
    1.010 = 1 percent larger
    */

    basemapShiftX: 0,
    basemapShiftY: 0,
    basemapScaleX: 1,
    basemapScaleY: 1,

    // Fixed roadway line thickness.
    lineWidth: 8
};

// =====================================================
// BASEMAP CALIBRATION LIMITS
// =====================================================

const BASEMAP_CONTROL_SETTINGS = {
    shiftMinimum: -250,
    shiftMaximum: 250,
    shiftStep: 1,

    scaleMinimum: 0.5,
    scaleMaximum: 1.5,
    scaleStep: 0.001
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
// WEIGHT CONTROL SETTINGS
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

    // Default map classification method.
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

basemap.onerror =
    function ()
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
// CALCULATE ADJUSTED BASEMAP FRAME
// =====================================================

function adjustedBasemapFrame()
{
    const frame =
        mapFrame();

    const adjustedWidth =
        frame.width
        * DISPLAY.basemapScaleX;

    const adjustedHeight =
        frame.height
        * DISPLAY.basemapScaleY;

    /*
    Scaling is performed around the center of the original
    basemap frame.

    This means increasing Scale X expands the image equally
    toward the left and right.

    Increasing Scale Y expands the image equally toward the
    top and bottom.
    */

    const adjustedX =
        frame.x
        -
        (
            adjustedWidth
            - frame.width
        )
        / 2
        +
        DISPLAY.basemapShiftX;

    const adjustedY =
        frame.y
        -
        (
            adjustedHeight
            - frame.height
        )
        / 2
        +
        DISPLAY.basemapShiftY;

    return {
        x:
            adjustedX,

        y:
            adjustedY,

        width:
            adjustedWidth,

        height:
            adjustedHeight
    };
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

function calculateNormalizedIndexScores(
    index
)
{
    const rawScores =
        new Map();

    let peakScore = 0;

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

    const standardDeviation =
        Math.sqrt(
            variance
        );

    return {
        minimum:
            minimum,

        maximum:
            maximum,

        mean:
            mean,

        standardDeviation:
            standardDeviation
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

            const classNumber =
                getColorClass(
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
    state.classBreaks = [];

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

    const break1 =
        formatClassificationValue(
            state.classBreaks[0]
        );

    const break2 =
        formatClassificationValue(
            state.classBreaks[1]
        );

    const break3 =
        formatClassificationValue(
            state.classBreaks[2]
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
        + `${break1}, ${break2}, and ${break3}.`;
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
            return false;
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

        return true;
    }

    rangeInput.addEventListener(
        "input",
        function ()
        {
            const value =
                normalizeWeight(
                    rangeInput.value
                );

            if (
                value === null
            )
            {
                return;
            }

            numberInput.value =
                value.toFixed(
                    1
                );

            changeFunction(
                value
            );
        }
    );

    numberInput.addEventListener(
        "input",
        function ()
        {
            if (
                numberInput.value.trim() === ""
            )
            {
                return;
            }

            const value =
                normalizeWeight(
                    numberInput.value
                );

            if (
                value === null
            )
            {
                return;
            }

            rangeInput.value =
                String(
                    value
                );

            changeFunction(
                value
            );
        }
    );

    numberInput.addEventListener(
        "blur",
        function ()
        {
            if (
                numberInput.value.trim() === ""
                ||
                normalizeWeight(
                    numberInput.value
                ) === null
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
                numberInput.value
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

            if (
                numberInput.value.trim() === ""
            )
            {
                numberInput.value =
                    Number(
                        rangeInput.value
                    ).toFixed(
                        1
                    );
            }
            else
            {
                applyWeight(
                    numberInput.value
                );
            }

            numberInput.blur();
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
            state.indexW[
                index.id
            ] =
                WEIGHT_SETTINGS.defaultValue;

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

    const equalIntervalLabel =
        document.createElement(
            "label"
        );

    const equalIntervalInput =
        document.createElement(
            "input"
        );

    equalIntervalInput.type =
        "radio";

    equalIntervalInput.name =
        "classificationMethod";

    equalIntervalInput.value =
        CLASSIFICATION_METHODS.equalInterval;

    equalIntervalInput.checked =
        state.classificationMethod
        ===
        CLASSIFICATION_METHODS.equalInterval;

    const equalIntervalText =
        document.createElement(
            "span"
        );

    equalIntervalText.textContent =
        "4 Equal Intervals";

    equalIntervalLabel.appendChild(
        equalIntervalInput
    );

    equalIntervalLabel.appendChild(
        equalIntervalText
    );

    const standardDeviationLabel =
        document.createElement(
            "label"
        );

    const standardDeviationInput =
        document.createElement(
            "input"
        );

    standardDeviationInput.type =
        "radio";

    standardDeviationInput.name =
        "classificationMethod";

    standardDeviationInput.value =
        CLASSIFICATION_METHODS.standardDeviation;

    standardDeviationInput.checked =
        state.classificationMethod
        ===
        CLASSIFICATION_METHODS.standardDeviation;

    const standardDeviationText =
        document.createElement(
            "span"
        );

    standardDeviationText.textContent =
        "Standard Deviation";

    standardDeviationLabel.appendChild(
        standardDeviationInput
    );

    standardDeviationLabel.appendChild(
        standardDeviationText
    );

    equalIntervalInput.addEventListener(
        "change",
        function ()
        {
            if (
                !equalIntervalInput.checked
            )
            {
                return;
            }

            state.classificationMethod =
                CLASSIFICATION_METHODS.equalInterval;

            assignColorClasses();
            updateStatusMessage();
            draw();
        }
    );

    standardDeviationInput.addEventListener(
        "change",
        function ()
        {
            if (
                !standardDeviationInput.checked
            )
            {
                return;
            }

            state.classificationMethod =
                CLASSIFICATION_METHODS.standardDeviation;

            assignColorClasses();
            updateStatusMessage();
            draw();
        }
    );

    options.appendChild(
        equalIntervalLabel
    );

    options.appendChild(
        standardDeviationLabel
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
// CLAMP A NUMBER
// =====================================================

function clampNumber(
    value,
    minimum,
    maximum
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

    return Math.min(
        maximum,
        Math.max(
            minimum,
            numericValue
        )
    );
}

// =====================================================
// CREATE BASEMAP CALIBRATION CONTROL
// =====================================================

function createBasemapCalibrationControl(
    labelText,
    propertyName,
    minimum,
    maximum,
    step,
    decimalPlaces
)
{
    const container =
        document.createElement(
            "div"
        );

    container.className =
        "slider calibration-slider";

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
        "weight-number calibration-number";

    numberInput.min =
        String(
            minimum
        );

    numberInput.max =
        String(
            maximum
        );

    numberInput.step =
        String(
            step
        );

    numberInput.value =
        Number(
            DISPLAY[
                propertyName
            ]
        ).toFixed(
            decimalPlaces
        );

    numberInput.setAttribute(
        "aria-label",
        labelText
    );

    const rangeInput =
        document.createElement(
            "input"
        );

    rangeInput.type =
        "range";

    rangeInput.min =
        String(
            minimum
        );

    rangeInput.max =
        String(
            maximum
        );

    rangeInput.step =
        String(
            step
        );

    rangeInput.value =
        String(
            DISPLAY[
                propertyName
            ]
        );

    rangeInput.setAttribute(
        "aria-label",
        labelText + " slider"
    );

    function applyValue(
        value,
        formatNumberBox
    )
    {
        const clampedValue =
            clampNumber(
                value,
                minimum,
                maximum
            );

        if (
            clampedValue === null
        )
        {
            return;
        }

        DISPLAY[
            propertyName
        ] =
            clampedValue;

        rangeInput.value =
            String(
                clampedValue
            );

        if (
            formatNumberBox
        )
        {
            numberInput.value =
                clampedValue.toFixed(
                    decimalPlaces
                );
        }

        updateBasemapCalibrationReadout();
        draw();
    }

    rangeInput.addEventListener(
        "input",
        function ()
        {
            numberInput.value =
                Number(
                    rangeInput.value
                ).toFixed(
                    decimalPlaces
                );

            applyValue(
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
                numberInput.value.trim() === ""
            )
            {
                return;
            }

            applyValue(
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
                numberInput.value.trim() === ""
                ||
                clampNumber(
                    numberInput.value,
                    minimum,
                    maximum
                ) === null
            )
            {
                numberInput.value =
                    Number(
                        DISPLAY[
                            propertyName
                        ]
                    ).toFixed(
                        decimalPlaces
                    );

                return;
            }

            applyValue(
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

            applyValue(
                numberInput.value,
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

    /*
    Save references so the calibration reset button can
    update the controls without reloading the page.
    */

    container.rangeInput =
        rangeInput;

    container.numberInput =
        numberInput;

    container.propertyName =
        propertyName;

    container.decimalPlaces =
        decimalPlaces;

    return container;
}

// =====================================================
// BASEMAP CALIBRATION READOUT
// =====================================================

function getBasemapCalibrationText()
{
    return (
        "basemapShiftX: "
        + DISPLAY.basemapShiftX.toFixed(0)
        + ", basemapShiftY: "
        + DISPLAY.basemapShiftY.toFixed(0)
        + ", basemapScaleX: "
        + DISPLAY.basemapScaleX.toFixed(3)
        + ", basemapScaleY: "
        + DISPLAY.basemapScaleY.toFixed(3)
    );
}

function updateBasemapCalibrationReadout()
{
    const readout =
        document.getElementById(
            "basemapCalibrationReadout"
        );

    if (
        !readout
    )
    {
        return;
    }

    readout.textContent =
        getBasemapCalibrationText();
}

// =====================================================
// COPY BASEMAP CALIBRATION VALUES
// =====================================================

function copyBasemapCalibrationValues(
    button
)
{
    const calibrationCode =
        "basemapShiftX: "
        + DISPLAY.basemapShiftX.toFixed(0)
        + ",\n"
        + "basemapShiftY: "
        + DISPLAY.basemapShiftY.toFixed(0)
        + ",\n"
        + "basemapScaleX: "
        + DISPLAY.basemapScaleX.toFixed(3)
        + ",\n"
        + "basemapScaleY: "
        + DISPLAY.basemapScaleY.toFixed(3);

    if (
        navigator.clipboard
        &&
        navigator.clipboard.writeText
    )
    {
        navigator.clipboard.writeText(
            calibrationCode
        )
        .then(
            function ()
            {
                const originalText =
                    button.textContent;

                button.textContent =
                    "Values Copied";

                window.setTimeout(
                    function ()
                    {
                        button.textContent =
                            originalText;
                    },
                    1500
                );
            }
        )
        .catch(
            function ()
            {
                window.prompt(
                    "Copy these basemap values:",
                    calibrationCode
                );
            }
        );

        return;
    }

    window.prompt(
        "Copy these basemap values:",
        calibrationCode
    );
}

// =====================================================
// BUILD BASEMAP CALIBRATION CONTROLS
// =====================================================

function buildBasemapCalibrationControls()
{
    const panel =
        document.createElement(
            "div"
        );

    panel.className =
        "classification-control basemap-calibration";

    panel.id =
        "basemapCalibrationPanel";

    const heading =
        document.createElement(
            "div"
        );

    heading.className =
        "classification-title";

    heading.textContent =
        "Basemap Calibration";

    const instructions =
        document.createElement(
            "p"
        );

    instructions.className =
        "calibration-instructions";

    instructions.textContent =
        "Adjust the image until the basemap aligns with the roadway linework.";

    const shiftXControl =
        createBasemapCalibrationControl(
            "Horizontal Position",
            "basemapShiftX",
            BASEMAP_CONTROL_SETTINGS.shiftMinimum,
            BASEMAP_CONTROL_SETTINGS.shiftMaximum,
            BASEMAP_CONTROL_SETTINGS.shiftStep,
            0
        );

    const shiftYControl =
        createBasemapCalibrationControl(
            "Vertical Position",
            "basemapShiftY",
            BASEMAP_CONTROL_SETTINGS.shiftMinimum,
            BASEMAP_CONTROL_SETTINGS.shiftMaximum,
            BASEMAP_CONTROL_SETTINGS.shiftStep,
            0
        );

    const scaleXControl =
        createBasemapCalibrationControl(
            "Horizontal Scale",
            "basemapScaleX",
            BASEMAP_CONTROL_SETTINGS.scaleMinimum,
            BASEMAP_CONTROL_SETTINGS.scaleMaximum,
            BASEMAP_CONTROL_SETTINGS.scaleStep,
            3
        );

    const scaleYControl =
        createBasemapCalibrationControl(
            "Vertical Scale",
            "basemapScaleY",
            BASEMAP_CONTROL_SETTINGS.scaleMinimum,
            BASEMAP_CONTROL_SETTINGS.scaleMaximum,
            BASEMAP_CONTROL_SETTINGS.scaleStep,
            3
        );

    const readout =
        document.createElement(
            "div"
        );

    readout.id =
        "basemapCalibrationReadout";

    readout.className =
        "calibration-readout";

    const buttonRow =
        document.createElement(
            "div"
        );

    buttonRow.className =
        "calibration-buttons";

    const resetCalibrationButton =
        document.createElement(
            "button"
        );

    resetCalibrationButton.type =
        "button";

    resetCalibrationButton.className =
        "secondary-button";

    resetCalibrationButton.textContent =
        "Reset Basemap";

    const copyValuesButton =
        document.createElement(
            "button"
        );

    copyValuesButton.type =
        "button";

    copyValuesButton.textContent =
        "Copy Values";

    const calibrationControls = [
        shiftXControl,
        shiftYControl,
        scaleXControl,
        scaleYControl
    ];

    resetCalibrationButton.addEventListener(
        "click",
        function ()
        {
            DISPLAY.basemapShiftX = 0;
            DISPLAY.basemapShiftY = 0;
            DISPLAY.basemapScaleX = 1;
            DISPLAY.basemapScaleY = 1;

            calibrationControls.forEach(
                function (control)
                {
                    const value =
                        DISPLAY[
                            control.propertyName
                        ];

                    control.rangeInput.value =
                        String(
                            value
                        );

                    control.numberInput.value =
                        Number(
                            value
                        ).toFixed(
                            control.decimalPlaces
                        );
                }
            );

            updateBasemapCalibrationReadout();
            draw();
        }
    );

    copyValuesButton.addEventListener(
        "click",
        function ()
        {
            copyBasemapCalibrationValues(
                copyValuesButton
            );
        }
    );

    buttonRow.appendChild(
        resetCalibrationButton
    );

    buttonRow.appendChild(
        copyValuesButton
    );

    panel.appendChild(
        heading
    );

    panel.appendChild(
        instructions
    );

    panel.appendChild(
        shiftXControl
    );

    panel.appendChild(
        shiftYControl
    );

    panel.appendChild(
        scaleXControl
    );

    panel.appendChild(
        scaleYControl
    );

    panel.appendChild(
        readout
    );

    panel.appendChild(
        buttonRow
    );

    insertControlBeforeReset(
        panel
    );

    updateBasemapCalibrationReadout();
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
    The basemap is adjusted independently from the linework.

    The roadway linework continues to use the original map
    frame so it remains fixed while the image is calibrated.
    */

    if (
        basemap.complete
        &&
        basemap.naturalWidth > 0
    )
    {
        const basemapFrame =
            adjustedBasemapFrame();

        ctx.drawImage(
            basemap,
            basemapFrame.x,
            basemapFrame.y,
            basemapFrame.width,
            basemapFrame.height
        );
    }

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
        buildBasemapCalibrationControls();

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

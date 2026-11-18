// =====================================================
// US 83 NEED INDEX EXPLORER
// VERSION 5.5
// =====================================================

console.log("US 83 Need Index Explorer version 5.5");

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
    scores: new Map(),
    colorClasses: new Map(),
    indexW: {},
    fieldW: {},
    useFutureVolumeFactor: true,

    classificationMethod:
        CLASSIFICATION_METHODS.equalInterval,

    classBreaks: [],

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

    return [
        frame.x
        +
        (
            longitude
            - EXT.west
        )
        * frame.scale,

        frame.y
        +
        (
            EXT.north
            - latitude
        )
        * frame.scale
    ];
}

// =====================================================
// ADJUSTED IMAGE FRAME
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

    return {
        x:
            frame.x
            -
            (
                width
                - frame.width
            )
            / 2
            +
            DISPLAY.basemapShiftX,

        y:
            frame.y
            -
            (
                height
                - frame.height
            )
            / 2
            +
            DISPLAY.basemapShiftY,

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
// RAW INDEX SCORE
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

    return weightedFieldTotal
        * safeNumber(
            row.futureVolumeFactor
        );
}

// =====================================================
// NORMALIZE INDEX AGAINST PEAK
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

            normalizedScores.set(
                segment.segmentId,

                peakScore === 0
                    ? 0
                    : rawScore
                        / peakScore
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
// RECALCULATE SCORES
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
                combinedWeightTotal > 0
            )
            {
                state.scores.set(
                    segment.segmentId,

                    combinedWeightedTotal
                    / combinedWeightTotal
                );
            }
        }
    );

    assignColorClasses();
    updateStatusMessage();
    draw();
}

// =====================================================
// CLASSIFICATION STATISTICS
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

    const mean =
        scores.reduce(
            function (
                total,
                score
            )
            {
                return total
                    + score;
            },
            0
        )
        / scores.length;

    const variance =
        scores.reduce(
            function (
                total,
                score
            )
            {
                const difference =
                    score
                    - mean;

                return total
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
// EQUAL INTERVAL BREAKS
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
// STANDARD DEVIATION BREAKS
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
// CALCULATE CLASS BREAKS
// =====================================================

function calculateClassBreaks()
{
    const statistics =
        calculateScoreStatistics(
            getFiniteScores()
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
    }
    else
    {
        state.classBreaks =
            buildEqualIntervalBreaks(
                statistics
            );
    }
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

function getClassColor(
    score
)
{
    return COLOR_CLASSES[
        getColorClass(
            score
        )
    ].color;
}

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
                Number.isFinite(
                    score
                )
            )
            {
                state.colorClasses.set(
                    segmentId,
                    getColorClass(
                        score
                    )
                );
            }
        }
    );
}

// =====================================================
// STATUS MESSAGE
// =====================================================

function formatClassificationValue(
    value
)
{
    return Number.isFinite(
        value
    )
        ? value.toFixed(3)
        : "0.000";
}

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
// NORMALIZE WEIGHT
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
// CREATE WEIGHT CONTROL
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
                !== ""
            )
            {
                applyWeight(
                    numberInput.value,
                    false
                );
            }
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
                event.key === "Enter"
            )
            {
                event.preventDefault();

                applyWeight(
                    numberInput.value
                    || rangeInput.value,
                    true
                );

                numberInput.blur();
            }
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
// BUILD WEIGHT CONTROLS
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
// INSERT CONTROL BEFORE RESET
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
// FUTURE VOLUME FACTOR TOGGLE
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
// CLASSIFICATION SELECTOR
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

    function addOption(
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

    addOption(
        CLASSIFICATION_METHODS.equalInterval,
        "4 Equal Intervals",

        state.classificationMethod
        ===
        CLASSIFICATION_METHODS.equalInterval
    );

    addOption(
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
// BASEMAP CALIBRATION UTILITIES
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
                numberInput.value.trim()
                !== ""
            )
            {
                applyValue(
                    numberInput.value,
                    false
                );
            }
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
                clampNumber(
                    numberInput.value,
                    minimum,
                    maximum
                )
                === null
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
                event.key === "Enter"
            )
            {
                event.preventDefault();

                applyValue(
                    numberInput.value,
                    true
                );

                numberInput.blur();
            }
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
// CALIBRATION READOUT
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
        readout
    )
    {
        readout.textContent =
            getBasemapCalibrationText();
    }
}

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
    }
    else
    {
        window.prompt(
            "Copy these basemap values:",
            calibrationCode
        );
    }
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
        "Basemap and Labels Calibration";

    const instructions =
        document.createElement(
            "p"
        );

    instructions.className =
        "calibration-instructions";

    instructions.textContent =
        "These controls move and resize the basemap and labels together while the roadway linework remains fixed.";

    const controls = [
        createBasemapCalibrationControl(
            "Horizontal Position",
            "basemapShiftX",
            BASEMAP_CONTROL_SETTINGS.shiftMinimum,
            BASEMAP_CONTROL_SETTINGS.shiftMaximum,
            BASEMAP_CONTROL_SETTINGS.shiftStep,
            0
        ),

        createBasemapCalibrationControl(
            "Vertical Position",
            "basemapShiftY",
            BASEMAP_CONTROL_SETTINGS.shiftMinimum,
            BASEMAP_CONTROL_SETTINGS.shiftMaximum,
            BASEMAP_CONTROL_SETTINGS.shiftStep,
            0
        ),

        createBasemapCalibrationControl(
            "Horizontal Scale",
            "basemapScaleX",
            BASEMAP_CONTROL_SETTINGS.scaleMinimum,
            BASEMAP_CONTROL_SETTINGS.scaleMaximum,
            BASEMAP_CONTROL_SETTINGS.scaleStep,
            3
        ),

        createBasemapCalibrationControl(
            "Vertical Scale",
            "basemapScaleY",
            BASEMAP_CONTROL_SETTINGS.scaleMinimum,
            BASEMAP_CONTROL_SETTINGS.scaleMaximum,
            BASEMAP_CONTROL_SETTINGS.scaleStep,
            3
        )
    ];

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
        "Reset Images";

    const copyValuesButton =
        document.createElement(
            "button"
        );

    copyValuesButton.type =
        "button";

    copyValuesButton.textContent =
        "Copy Values";

    resetCalibrationButton.addEventListener(
        "click",
        function ()
        {
            DISPLAY.basemapShiftX =
                0;

            DISPLAY.basemapShiftY =
                0;

            DISPLAY.basemapScaleX =
                1;

            DISPLAY.basemapScaleY =
                1;

            controls.forEach(
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

    controls.forEach(
        function (control)
        {
            panel.appendChild(
                control
            );
        }
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
// DRAW IMAGE USING CALIBRATED FRAME
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

    // Draw the main basemap first.
    drawImageToAdjustedFrame(
        basemap
    );

    // Draw roadway lines above the basemap.
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

    // Draw the transparent labels overlay last.
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

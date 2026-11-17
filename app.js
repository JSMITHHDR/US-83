// =====================================================
// US 83 NEED INDEX EXPLORER
// VERSION 4.1
// =====================================================

console.log(
    "US 83 Need Index Explorer version 4.1"
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

// Use the raw GitHub image URL.
const BASEMAP =
    "https://raw.githubusercontent.com/JSMITHHDR/US-83/5165469a29e097b35ddc90d6901b971ff3d13df0/State%20Narrow.png";

// =====================================================
// FIXED DISPLAY SETTINGS
// =====================================================

const DISPLAY = {
    // Positive values move the basemap right.
    basemapShiftX: 0,

    // Negative values move the basemap up.
    basemapShiftY: -7,

    // Fixed roadway line thickness.
    lineWidth: 8
};

// =====================================================
// APPLICATION STATE
// =====================================================

const state = {
    segments: [],
    indices: [],

    // Calculated combined Need Index by Segment ID.
    scores: new Map(),

    // Four-bucket classification by Segment ID.
    colorBuckets: new Map(),

    // Index-level slider weights.
    indexW: {},

    // Field-level slider weights.
    fieldW: {}
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
    One scale is used for both dimensions.

    This prevents the basemap and linework from being
    independently stretched to the canvas width and height.
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
// PROJECT LINE COORDINATES
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
// FOUR DISCRETE COLOR BUCKETS
// =====================================================

/*
The segments are ranked by their current combined Need Index.

The ranked segments are divided into four approximately
equal groups:

1. Lower need
2. Moderate need
3. High need
4. Highest need
*/

const COLOR_BUCKETS = [
    {
        label: "Lower need",
        color: "#2E7D32"
    },
    {
        label: "Moderate need",
        color: "#D4C900"
    },
    {
        label: "High need",
        color: "#F9A825"
    },
    {
        label: "Highest need",
        color: "#C62828"
    }
];

function getBucketColor(
    bucketNumber
)
{
    const safeBucketNumber =
        Math.max(
            0,
            Math.min(
                COLOR_BUCKETS.length - 1,
                bucketNumber
            )
        );

    return COLOR_BUCKETS[
        safeBucketNumber
    ].color;
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
// CALCULATE ONE NEED INDEX
// =====================================================

function calculateIndexScore(
    row,
    index
)
{
    let weightedTotal = 0;
    let weightTotal = 0;

    index.fields.forEach(
        function (field)
        {
            const rawValue =
                row.values[
                    field
                ];

            /*
            Exclude missing and nonnumeric values.

            This prevents missing values from behaving as
            zero values in the weighted average.
            */

            if (
                rawValue === null
                ||
                rawValue === ""
                ||
                !Number.isFinite(
                    Number(rawValue)
                )
            )
            {
                return;
            }

            const fieldWeight =
                Number(
                    state.fieldW[
                        index.id
                    ]?.[field]
                    ?? 0
                );

            /*
            A field weight of zero removes the field from
            both the numerator and denominator.
            */

            if (fieldWeight <= 0)
            {
                return;
            }

            const fieldScale =
                Number(
                    index.scales?.[
                        field
                    ]
                    ?? 1
                );

            const safeScale =
                fieldScale > 0
                    ? fieldScale
                    : 1;

            const normalizedValue =
                Number(rawValue)
                / safeScale;

            weightedTotal +=
                normalizedValue
                * fieldWeight;

            weightTotal +=
                fieldWeight;
        }
    );

    /*
    Null means the index has no active fields.

    This is different from a legitimate calculated score
    of zero.
    */

    if (weightTotal <= 0)
    {
        return null;
    }

    const weightedMean =
        weightedTotal
        / weightTotal;

    const rawFutureVolumeFactor =
        Number(
            row.futureVolumeFactor
        );

    const futureVolumeFactor =
        Number.isFinite(
            rawFutureVolumeFactor
        )
            ? rawFutureVolumeFactor
            : 1;

    return weightedMean
        * futureVolumeFactor;
}

// =====================================================
// ASSIGN FOUR COLOR BUCKETS
// =====================================================

function assignColorBuckets()
{
    state.colorBuckets.clear();

    const sortedScores =
        Array.from(
            state.scores.entries()
        )
        .filter(
            function (entry)
            {
                return Number.isFinite(
                    entry[1]
                );
            }
        )
        .sort(
            function (
                first,
                second
            )
            {
                return first[1]
                    - second[1];
            }
        );

    const segmentCount =
        sortedScores.length;

    if (segmentCount === 0)
    {
        return;
    }

    sortedScores.forEach(
        function (
            entry,
            sortedIndex
        )
        {
            const segmentId =
                entry[0];

            const percentile =
                segmentCount === 1
                    ? 0.5
                    : sortedIndex
                    / (
                        segmentCount
                        - 1
                    );

            let bucketNumber;

            if (percentile < 0.25)
            {
                bucketNumber = 0;
            }
            else if (percentile < 0.50)
            {
                bucketNumber = 1;
            }
            else if (percentile < 0.75)
            {
                bucketNumber = 2;
            }
            else
            {
                bucketNumber = 3;
            }

            state.colorBuckets.set(
                segmentId,
                bucketNumber
            );
        }
    );
}

// =====================================================
// RECALCULATE ALL SEGMENT SCORES
// =====================================================

function recalculateScores()
{
    state.scores.clear();

    state.colorBuckets.clear();

    /*
    If all index sliders are zero, stop before assigning
    any segment scores.

    This prevents the previous default green line from
    appearing when every index is turned off.
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

    state.segments.forEach(
        function (segment)
        {
            let combinedTotal = 0;
            let combinedWeight = 0;

            state.indices.forEach(
                function (index)
                {
                    const indexWeight =
                        Number(
                            state.indexW[
                                index.id
                            ]
                            ?? 0
                        );

                    /*
                    An index weight of zero removes that index
                    from the combined Need Index.
                    */

                    if (indexWeight <= 0)
                    {
                        return;
                    }

                    const row =
                        index.rows[
                            segment.segmentId
                        ];

                    if (!row)
                    {
                        return;
                    }

                    const indexScore =
                        calculateIndexScore(
                            row,
                            index
                        );

                    /*
                    Null means every field in this index has
                    been disabled or is missing.
                    */

                    if (
                        indexScore === null
                        ||
                        !Number.isFinite(
                            indexScore
                        )
                    )
                    {
                        return;
                    }

                    combinedTotal +=
                        indexScore
                        * indexWeight;

                    combinedWeight +=
                        indexWeight;
                }
            );

            /*
            Do not assign a default score if this segment
            has no active index calculation.
            */

            if (combinedWeight <= 0)
            {
                return;
            }

            const combinedScore =
                combinedTotal
                / combinedWeight;

            state.scores.set(
                segment.segmentId,
                combinedScore
            );
        }
    );

    assignColorBuckets();

    statusEl.textContent =
        `${state.scores.size} scored segments displayed in four color buckets.`;

    draw();
}

// =====================================================
// CREATE WEIGHT SLIDER
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

    const output =
        document.createElement(
            "output"
        );

    output.textContent =
        "1.0x";

    label.appendChild(
        labelName
    );

    label.appendChild(
        output
    );

    const input =
        document.createElement(
            "input"
        );

    input.type =
        "range";

    input.min =
        "0";

    input.max =
        "5";

    input.step =
        "0.1";

    input.value =
        "1";

    input.addEventListener(
        "input",
        function ()
        {
            const value =
                Number(
                    input.value
                );

            output.textContent =
                value.toFixed(1)
                + "x";

            changeFunction(
                value
            );
        }
    );

    container.appendChild(
        label
    );

    container.appendChild(
        input
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
                1;

            state.fieldW[
                index.id
            ] =
                {};

            // Index-level slider

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

            // Expandable field slider group

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
// PREPARE FIELD NORMALIZATION
// =====================================================

function prepareFieldScales()
{
    state.indices.forEach(
        function (index)
        {
            index.scales =
                {};

            index.fields.forEach(
                function (field)
                {
                    let maximumValue =
                        1;

                    Object.values(
                        index.rows
                    ).forEach(
                        function (row)
                        {
                            const value =
                                Number(
                                    row.values[
                                        field
                                    ]
                                );

                            if (
                                Number.isFinite(
                                    value
                                )
                            )
                            {
                                maximumValue =
                                    Math.max(
                                        maximumValue,
                                        value
                                    );
                            }
                        }
                    );

                    index.scales[
                        field
                    ] =
                        maximumValue;
                }
            );
        }
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
    Draw the basemap using the same extent and scale used
    for the linework.

    The -7 pixel adjustment moves only the basemap upward.
    The roadway line coordinates remain fixed.
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
    Do not draw any roadways if all five index weights
    are zero.
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
            /*
            Only draw a segment when it has both a calculated
            score and a valid four-bucket assignment.
            */

            if (
                !state.scores.has(
                    segment.segmentId
                )
                ||
                !state.colorBuckets.has(
                    segment.segmentId
                )
            )
            {
                return;
            }

            const bucketNumber =
                state.colorBuckets.get(
                    segment.segmentId
                );

            createSegmentPath(
                segment
            );

            /*
            One colored stroke only.

            No dark, gray, or white casing is applied.
            */

            ctx.strokeStyle =
                getBucketColor(
                    bucketNumber
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

        prepareFieldScales();

        buildWeightControls();

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

// Initial canvas sizing
resizeCanvas();

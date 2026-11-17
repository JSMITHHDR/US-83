// =====================================================
// US 83 NEED INDEX EXPLORER
// VERSION 5.0
// =====================================================

console.log(
    "US 83 Need Index Explorer version 5.0"
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
// APPLICATION STATE
// =====================================================

const state = {
    segments: [],
    indices: [],

    // Final combined score by Segment ID.
    scores: new Map(),

    // Four-bucket classification by Segment ID.
    colorBuckets: new Map(),

    // Main index-level slider weights.
    indexW: {},

    // Individual field slider weights.
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
    Use one common scale for both dimensions.

    This prevents the background and the linework from
    being stretched independently.
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
// FOUR DISCRETE COLOR BUCKETS
// =====================================================

/*
The final combined scores are ranked and divided into
four approximately equal groups.

Bucket 1: Lowest 25 percent
Bucket 2: 25th to 50th percentile
Bucket 3: 50th to 75th percentile
Bucket 4: Highest 25 percent
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
    const safeBucket =
        Math.max(
            0,
            Math.min(
                COLOR_BUCKETS.length - 1,
                bucketNumber
            )
        );

    return COLOR_BUCKETS[
        safeBucket
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
This reproduces the first part of the Excel formula:

(
    Field1 * Weight1
    + Field2 * Weight2
    + ...
)
* FutureVolumeFactor

The field-weight total is not used as a denominator.
The input fields are not individually normalized.
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
This reproduces:

peak, MAX(scores)

and:

IF(
    peak=0,
    0,
    currentSegmentScore / peak
)

Every index is recalculated independently because each
index has its own fields and field-slider weights.
*/

function calculateNormalizedIndexScores(
    index
)
{
    const rawScores =
        new Map();

    let peakScore = 0;

    // First pass: calculate all raw scores and find peak.

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
                /*
                Sort by score first.
                */

                const scoreDifference =
                    first[1]
                    - second[1];

                if (scoreDifference !== 0)
                {
                    return scoreDifference;
                }

                /*
                Use Segment ID as a stable tie breaker.
                */

                return String(
                    first[0]
                ).localeCompare(
                    String(
                        second[0]
                    )
                );
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

            /*
            Dividing the sorted position by the record count
            creates four approximately equal groups.

            With 55 segments, the groups will contain roughly
            13 to 14 segments each.
            */

            const bucketNumber =
                Math.min(
                    3,
                    Math.floor(
                        (
                            sortedIndex
                            * 4
                        )
                        / segmentCount
                    )
                );

            state.colorBuckets.set(
                segmentId,
                bucketNumber
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

    state.colorBuckets.clear();

    /*
    If every main index slider is zero, stop immediately.

    No zero scores or green fallback lines are created.
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
    Calculate the Excel-style normalized score for each
    individual index first.
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
    Combine the normalized individual indexes using the
    main index-level sliders.

    Dividing by the total active index weight means that
    only the relative index weights matter.

    For example, weights of 1,1,1,1,1 provide the same
    combination as 2,2,2,2,2.
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

            const combinedScore =
                combinedWeightedTotal
                / combinedWeightTotal;

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
            // Default equal index weight.

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
                    // Default equal field weight.

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
    Draw the basemap using the same scale as the linework.

    The basemap is shifted upward by 7 screen pixels.
    The linework remains fixed.
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
    Do not display any roadway lines when all main index
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
            Draw only the colored line.

            No casing or outline is drawn.
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

// Initial canvas sizing.
resizeCanvas();

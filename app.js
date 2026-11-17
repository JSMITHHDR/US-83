// =====================================================
// US 83 NEED INDEX EXPLORER
// VERSION 4.0
// =====================================================

console.log(
    "US 83 Need Index Explorer version 4.0"
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
// DISPLAY SETTINGS
// =====================================================

const DISPLAY = {
    // Positive X moves the basemap right.
    basemapShiftX: 0,

    // Positive Y moves the basemap down.
    basemapShiftY: 20,

    // Default colored-line width.
    lineWidth: 18
};

// =====================================================
// APPLICATION STATE
// =====================================================

const state = {
    segments: [],
    indices: [],

    // Actual combined Need Index by Segment ID.
    scores: new Map(),

    // Four-bucket color assignment by Segment ID.
    colorBuckets: new Map(),

    // Index-level weights.
    indexW: {},

    // Field-level weights.
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
// MAP FRAME
// =====================================================

/*
The basemap and linework use the same aspect-preserving
frame. This prevents the map from being stretched to the
canvas dimensions.
*/

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
Segments do not use a continuous gradient.

Each segment falls into one of four buckets based on its
rank among all currently scored segments:

Bucket 1: Lowest 25 percent
Bucket 2: 25th through 50th percentile
Bucket 3: 50th through 75th percentile
Bucket 4: Highest 25 percent
*/

const COLOR_BUCKETS = [
    {
        label: "Lower need",
        color: "#2E7D32"
    },
    {
        label: "Moderate need",
        color: "#C8C400"
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
    const bucket =
        COLOR_BUCKETS[
            Math.max(
                0,
                Math.min(
                    3,
                    bucketNumber
                )
            )
        ];

    return bucket.color;
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
                    state.indexW[index.id]
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
// CALCULATE ONE INDEX SCORE
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
                row.values[field];

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
            A field slider set to zero removes that field
            from the index calculation and denominator.
            */

            if (fieldWeight <= 0)
            {
                return;
            }

            const fieldScale =
                Number(
                    index.scales?.[field]
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
    Returning null distinguishes "no active fields" from
    an actual calculated score of zero.
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
// ASSIGN THE FOUR COLOR BUCKETS
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

            /*
            Rank-based quartiles produce four visible groups,
            even when the raw Need Index values are clustered.

            The highest-ranked segment is guaranteed to enter
            Bucket 4, and the lowest enters Bucket 1.
            */

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
    When all five index sliders are zero, stop immediately.

    No segments receive a default zero score, so no default
    green lines are displayed.
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
                    Null means every field in the index has
                    been removed by the field sliders.
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
            Do not assign a default score when a segment has
            no active index calculation.
            */

            if (combinedWeight <= 0)
            {
                return;
            }

            state.scores.set(
                segment.segmentId,
                combinedTotal
                / combinedWeight
            );
        }
    );

    assignColorBuckets();

    statusEl.textContent =
        `${state.scores.size} scored segments displayed in four color buckets.`;

    draw();
}

// =====================================================
// CREATE A STANDARD WEIGHT SLIDER
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
// BUILD INDEX AND FIELD CONTROLS
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
            state.indexW[index.id] =
                1;

            state.fieldW[index.id] =
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
// BUILD DISPLAY CONTROLS
// =====================================================

function buildDisplayControls()
{
    /*
    Remove an existing section first. This prevents duplicate
    controls if the setup function is called more than once.
    */

    const existingSection =
        document.getElementById(
            "displayControls"
        );

    if (existingSection)
    {
        existingSection.remove();
    }

    const section =
        document.createElement(
            "section"
        );

    section.id =
        "displayControls";

    const heading =
        document.createElement(
            "h2"
        );

    heading.textContent =
        "Map display";

    section.appendChild(
        heading
    );

    // -------------------------------------------------
    // LINE THICKNESS
    // -------------------------------------------------

    const thicknessContainer =
        document.createElement(
            "div"
        );

    thicknessContainer.className =
        "slider";

    const thicknessLabel =
        document.createElement(
            "label"
        );

    const thicknessName =
        document.createElement(
            "span"
        );

    thicknessName.textContent =
        "Line thickness";

    const thicknessOutput =
        document.createElement(
            "output"
        );

    thicknessOutput.textContent =
        `${DISPLAY.lineWidth}px`;

    thicknessLabel.appendChild(
        thicknessName
    );

    thicknessLabel.appendChild(
        thicknessOutput
    );

    const thicknessSlider =
        document.createElement(
            "input"
        );

    thicknessSlider.type =
        "range";

    thicknessSlider.min =
        "2";

    thicknessSlider.max =
        "40";

    thicknessSlider.step =
        "1";

    thicknessSlider.value =
        String(
            DISPLAY.lineWidth
        );

    thicknessSlider.addEventListener(
        "input",
        function ()
        {
            DISPLAY.lineWidth =
                Number(
                    thicknessSlider.value
                );

            thicknessOutput.textContent =
                `${DISPLAY.lineWidth}px`;

            draw();
        }
    );

    thicknessContainer.appendChild(
        thicknessLabel
    );

    thicknessContainer.appendChild(
        thicknessSlider
    );

    section.appendChild(
        thicknessContainer
    );

    // -------------------------------------------------
    // VERTICAL BASEMAP SHIFT
    // -------------------------------------------------

    const verticalContainer =
        document.createElement(
            "div"
        );

    verticalContainer.className =
        "slider";

    const verticalLabel =
        document.createElement(
            "label"
        );

    const verticalName =
        document.createElement(
            "span"
        );

    verticalName.textContent =
        "Basemap vertical shift";

    const verticalOutput =
        document.createElement(
            "output"
        );

    verticalOutput.textContent =
        `${DISPLAY.basemapShiftY}px`;

    verticalLabel.appendChild(
        verticalName
    );

    verticalLabel.appendChild(
        verticalOutput
    );

    const verticalSlider =
        document.createElement(
            "input"
        );

    verticalSlider.type =
        "range";

    verticalSlider.min =
        "-150";

    verticalSlider.max =
        "150";

    verticalSlider.step =
        "1";

    verticalSlider.value =
        String(
            DISPLAY.basemapShiftY
        );

    verticalSlider.addEventListener(
        "input",
        function ()
        {
            DISPLAY.basemapShiftY =
                Number(
                    verticalSlider.value
                );

            verticalOutput.textContent =
                `${DISPLAY.basemapShiftY}px`;

            draw();
        }
    );

    verticalContainer.appendChild(
        verticalLabel
    );

    verticalContainer.appendChild(
        verticalSlider
    );

    section.appendChild(
        verticalContainer
    );

    // -------------------------------------------------
    // HORIZONTAL BASEMAP SHIFT
    // -------------------------------------------------

    const horizontalContainer =
        document.createElement(
            "div"
        );

    horizontalContainer.className =
        "slider";

    const horizontalLabel =
        document.createElement(
            "label"
        );

    const horizontalName =
        document.createElement(
            "span"
        );

    horizontalName.textContent =
        "Basemap horizontal shift";

    const horizontalOutput =
        document.createElement(
            "output"
        );

    horizontalOutput.textContent =
        `${DISPLAY.basemapShiftX}px`;

    horizontalLabel.appendChild(
        horizontalName
    );

    horizontalLabel.appendChild(
        horizontalOutput
    );

    const horizontalSlider =
        document.createElement(
            "input"
        );

    horizontalSlider.type =
        "range";

    horizontalSlider.min =
        "-150";

    horizontalSlider.max =
        "150";

    horizontalSlider.step =
        "1";

    horizontalSlider.value =
        String(
            DISPLAY.basemapShiftX
        );

    horizontalSlider.addEventListener(
        "input",
        function ()
        {
            DISPLAY.basemapShiftX =
                Number(
                    horizontalSlider.value
                );

            horizontalOutput.textContent =
                `${DISPLAY.basemapShiftX}px`;

            draw();
        }
    );

    horizontalContainer.appendChild(
        horizontalLabel
    );

    horizontalContainer.appendChild(
        horizontalSlider
    );

    section.appendChild(
        horizontalContainer
    );

    // -------------------------------------------------
    // RESET DISPLAY BUTTON
    // -------------------------------------------------

    const resetDisplayButton =
        document.createElement(
            "button"
        );

    resetDisplayButton.type =
        "button";

    resetDisplayButton.textContent =
        "Reset map display";

    resetDisplayButton.addEventListener(
        "click",
        function ()
        {
            DISPLAY.lineWidth = 18;
            DISPLAY.basemapShiftX = 0;
            DISPLAY.basemapShiftY = 20;

            thicknessSlider.value =
                "18";

            horizontalSlider.value =
                "0";

            verticalSlider.value =
                "20";

            thicknessOutput.textContent =
                "18px";

            horizontalOutput.textContent =
                "0px";

            verticalOutput.textContent =
                "20px";

            draw();
        }
    );

    section.appendChild(
        resetDisplayButton
    );

    /*
    Insert the display section immediately before the
    index-weight section.
    */

    const indexSection =
        indexWeightsDiv.closest(
            "section"
        );

    indexSection.parentNode.insertBefore(
        section,
        indexSection
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

                    index.scales[field] =
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

    // Draw the shifted basemap.

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
    This guard prevents any default green lines when all
    five index weights are zero.
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
            Only draw segments that have both a calculated
            score and one of the four bucket assignments.
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
            There is deliberately only one stroke.
            No black, gray, or white line outline is drawn.
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

        buildDisplayControls();

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

resizeCanvas();

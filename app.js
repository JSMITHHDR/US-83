// =====================================================
// US 83 NEED INDEX EXPLORER
// =====================================================

// =====================================================
// MAP EXTENT
// =====================================================

const EXT = {
    west: -103.356215,
    east: -96.940124,
    south: 25.684963,
    north: 36.796656
};

// Use the raw GitHub URL rather than the normal GitHub page URL.
const BASEMAP =
    "https://raw.githubusercontent.com/JSMITHHDR/US-83/5165469a29e097b35ddc90d6901b971ff3d13df0/State%20Narrow.png";

// =====================================================
// APPLICATION STATE
// =====================================================

const state = {
    segments: [],
    indices: [],
    scores: new Map(),
    indexW: {},
    fieldW: {},
    min: 0,
    max: 1
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
        " Basemap could not load. Verify that the GitHub repository and image are publicly accessible.";

    draw();
};

// =====================================================
// MAP FRAME
// =====================================================

/*
The basemap and linework must use the same frame.

This uses one scale for both dimensions instead of
stretching longitude and latitude independently.
*/

function mapFrame()
{
    const canvasWidth =
        canvas.clientWidth;

    const canvasHeight =
        canvas.clientHeight;

    const extentWidth =
        EXT.east - EXT.west;

    const extentHeight =
        EXT.north - EXT.south;

    const scale =
        Math.min(
            canvasWidth / extentWidth,
            canvasHeight / extentHeight
        );

    const drawWidth =
        extentWidth * scale;

    const drawHeight =
        extentHeight * scale;

    const offsetX =
        (canvasWidth - drawWidth) / 2;

    const offsetY =
        (canvasHeight - drawHeight) / 2;

    return {
        x: offsetX,
        y: offsetY,
        width: drawWidth,
        height: drawHeight,
        scale: scale
    };
}

// =====================================================
// PROJECT LONGITUDE AND LATITUDE
// =====================================================

function project(lon, lat)
{
    const frame =
        mapFrame();

    const x =
        frame.x +
        (
            (lon - EXT.west)
            * frame.scale
        );

    const y =
        frame.y +
        (
            (EXT.north - lat)
            * frame.scale
        );

    return [x, y];
}

// =====================================================
// GREEN-YELLOW-RED COLOR RAMP
// =====================================================

function colorRamp(value)
{
    value =
        Math.max(
            0,
            Math.min(
                1,
                value
            )
        );

    const colors = [
        [0, 128, 0],      // green
        [255, 255, 0],    // yellow
        [215, 25, 28]     // red
    ];

    const scaled =
        value
        * (colors.length - 1);

    const colorIndex =
        Math.min(
            colors.length - 2,
            Math.floor(scaled)
        );

    const fraction =
        scaled - colorIndex;

    const firstColor =
        colors[colorIndex];

    const secondColor =
        colors[colorIndex + 1];

    const output =
        firstColor.map(
            function (channel, index)
            {
                return Math.round(
                    channel +
                    (
                        secondColor[index] - channel
                    )
                    * fraction
                );
            }
        );

    return `rgb(${output.join(",")})`;
}

// =====================================================
// CALCULATE AN INDIVIDUAL NEED INDEX
// =====================================================

function calculateIndexScore(row, index)
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
                !Number.isFinite(Number(rawValue))
            )
            {
                return;
            }

            const weight =
                state.fieldW[index.id]?.[field]
                ?? 1;

            const scale =
                index.scales?.[field]
                ?? 1;

            const normalizedValue =
                Number(rawValue)
                / scale;

            weightedTotal +=
                normalizedValue
                * weight;

            weightTotal +=
                weight;
        }
    );

    if (weightTotal === 0)
    {
        return 0;
    }

    const weightedMean =
        weightedTotal
        / weightTotal;

    const futureVolumeFactor =
        Number(
            row.futureVolumeFactor
        )
        || 1;

    return weightedMean
        * futureVolumeFactor;
}

// =====================================================
// RECALCULATE COMBINED NEED INDEX
// =====================================================

function recalculateScores()
{
    state.scores.clear();

    const scoreValues = [];

    state.segments.forEach(
        function (segment)
        {
            let combinedTotal = 0;
            let combinedWeight = 0;

            state.indices.forEach(
                function (index)
                {
                    const row =
                        index.rows[
                            segment.segmentId
                        ];

                    if (!row)
                    {
                        return;
                    }

                    const indexWeight =
                        state.indexW[index.id]
                        ?? 1;

                    /*
                    If an index slider is zero, that index
                    is excluded from the combined score.
                    */

                    if (indexWeight <= 0)
                    {
                        return;
                    }

                    const indexScore =
                        calculateIndexScore(
                            row,
                            index
                        );

                    combinedTotal +=
                        indexScore
                        * indexWeight;

                    combinedWeight +=
                        indexWeight;
                }
            );

            const combinedScore =
                combinedWeight > 0
                    ? combinedTotal / combinedWeight
                    : 0;

            state.scores.set(
                segment.segmentId,
                combinedScore
            );

            scoreValues.push(
                combinedScore
            );
        }
    );

    if (scoreValues.length > 0)
    {
        state.min =
            Math.min(...scoreValues);

        state.max =
            Math.max(...scoreValues);
    }
    else
    {
        state.min = 0;
        state.max = 1;
    }

    draw();
}

// =====================================================
// CREATE A SLIDER
// =====================================================

function createSlider(
    labelText,
    changeFunction
)
{
    const container =
        document.createElement("div");

    container.className =
        "slider";

    const label =
        document.createElement("label");

    const nameSpan =
        document.createElement("span");

    nameSpan.textContent =
        labelText;

    const output =
        document.createElement("output");

    output.textContent =
        "1.0x";

    label.appendChild(
        nameSpan
    );

    label.appendChild(
        output
    );

    const input =
        document.createElement("input");

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
                Number(input.value);

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
// BUILD SLIDER CONTROLS
// =====================================================

function buildControls()
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

            // Index-level slider

            const indexSlider =
                createSlider(
                    index.name,
                    function (value)
                    {
                        state.indexW[index.id] =
                            value;

                        recalculateScores();
                    }
                );

            indexWeightsDiv.appendChild(
                indexSlider
            );

            // Expandable field sliders

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
                    state.fieldW[index.id][field] =
                        1;

                    const fieldSlider =
                        createSlider(
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
                                    row.values[field]
                                );

                            if (
                                Number.isFinite(value)
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

    /*
    Fill the canvas behind the map. This makes any unused
    space created by the aspect-preserving fit intentional.
    */

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

    // Draw the basemap using the same frame as the lines.

    if (
        basemap.complete
        &&
        basemap.naturalWidth > 0
    )
    {
        ctx.drawImage(
            basemap,
            frame.x,
            frame.y,
            frame.width,
            frame.height
        );
    }

    ctx.lineCap =
        "round";

    ctx.lineJoin =
        "round";

    state.segments.forEach(
        function (segment)
        {
            const score =
                state.scores.get(
                    segment.segmentId
                )
                || 0;

            const scoreRange =
                state.max
                - state.min;

            const normalizedScore =
                scoreRange > 0
                    ? (
                        score
                        - state.min
                    )
                    / scoreRange
                    : 0.5;

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

            /*
            Draw a dark casing beneath each scored line.
            This helps very thick lines remain visible over
            both light and dark portions of the basemap.
            */

            if (state.indices.length > 0)
            {
                ctx.strokeStyle =
                    "rgba(45,45,45,0.85)";

                ctx.lineWidth =
                    22;

                ctx.stroke();

                /*
                Rebuild the path before applying the colored
                stroke because the casing has already drawn it.
                */

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

                ctx.strokeStyle =
                    colorRamp(
                        normalizedScore
                    );

                // Main green-yellow-red line thickness
                ctx.lineWidth =
                    18;

                ctx.stroke();
            }
            else
            {
                ctx.strokeStyle =
                    "#6b7280";

                ctx.lineWidth =
                    14;

                ctx.stroke();
            }
        }
    );
}

// =====================================================
// LOAD DATA
// =====================================================

Promise.all([
    fetch("segments.json")
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

    fetch("indices.json")
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

        buildControls();

        if (state.indices.length > 0)
        {
            statusEl.textContent =
                `${state.segments.length} segments and `
                + `${state.indices.length} indexes loaded.`;
        }
        else
        {
            statusEl.textContent =
                `${state.segments.length} segments loaded. `
                + "Index data is unavailable, so the lines are gray.";
        }

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
// RESET BUTTON
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

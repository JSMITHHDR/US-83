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

const BASEMAP =
    "https://raw.githubusercontent.com/JSMITHHDR/US-83/5165469a29e097b35ddc90d6901b971ff3d13df0/State%20Narrow.png";

// =====================================================
// DISPLAY SETTINGS
// =====================================================

const DISPLAY = {
    scoredLineWidth: 18,
    lineCasingWidth: 22,
    fallbackLineWidth: 14,

    // Basemap-only vertical shift in screen pixels.
    // Positive values move the basemap down.
    basemapShiftY: 0,

    // Optional horizontal adjustment.
    // Positive values move the basemap right.
    basemapShiftX: 0
};

// =====================================================
// APPLICATION STATE
// =====================================================

const state = {
    segments: [],
    indices: [],
    scores: new Map(),
    percentileScores: new Map(),
    indexW: {},
    fieldW: {},
    hasActiveIndexWeights: true
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
        " Basemap could not load. Verify that the GitHub image is publicly accessible.";

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

    return {
        x: (canvasWidth - drawWidth) / 2,
        y: (canvasHeight - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
        scale: scale
    };
}

// =====================================================
// PROJECT LINEWORK
// =====================================================

function project(lon, lat)
{
    const frame =
        mapFrame();

    return [
        frame.x +
        (
            lon - EXT.west
        )
        * frame.scale,

        frame.y +
        (
            EXT.north - lat
        )
        * frame.scale
    ];
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

    /*
    The middle portion of the ramp is intentionally wider
    so more segments appear yellow and orange.
    */

    const colors = [
        {
            stop: 0.00,
            rgb: [0, 128, 0]
        },
        {
            stop: 0.30,
            rgb: [102, 189, 99]
        },
        {
            stop: 0.45,
            rgb: [255, 255, 0]
        },
        {
            stop: 0.65,
            rgb: [253, 174, 97]
        },
        {
            stop: 0.80,
            rgb: [239, 85, 59]
        },
        {
            stop: 1.00,
            rgb: [180, 0, 0]
        }
    ];

    let lower =
        colors[0];

    let upper =
        colors[colors.length - 1];

    for (
        let index = 0;
        index < colors.length - 1;
        index++
    )
    {
        if (
            value >= colors[index].stop
            &&
            value <= colors[index + 1].stop
        )
        {
            lower =
                colors[index];

            upper =
                colors[index + 1];

            break;
        }
    }

    const stopRange =
        upper.stop
        - lower.stop;

    const interpolation =
        stopRange > 0
            ? (
                value
                - lower.stop
            )
            / stopRange
            : 0;

    const output =
        lower.rgb.map(
            function (
                lowerChannel,
                channelIndex
            )
            {
                const upperChannel =
                    upper.rgb[channelIndex];

                return Math.round(
                    lowerChannel
                    +
                    (
                        upperChannel
                        - lowerChannel
                    )
                    * interpolation
                );
            }
        );

    return `rgb(${output.join(",")})`;
}

// =====================================================
// CALCULATE INDIVIDUAL INDEX
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
                state.fieldW[index.id]?.[field]
                ?? 1;

            /*
            A field slider at zero completely removes that
            field from the index denominator.
            */

            if (fieldWeight <= 0)
            {
                return;
            }

            const fieldScale =
                index.scales?.[field]
                ?? 1;

            const normalizedValue =
                Number(rawValue)
                / fieldScale;

            weightedTotal +=
                normalizedValue
                * fieldWeight;

            weightTotal +=
                fieldWeight;
        }
    );

    if (weightTotal === 0)
    {
        return null;
    }

    const weightedMean =
        weightedTotal
        / weightTotal;

    const futureVolumeFactor =
        Number(
            row.futureVolumeFactor
        );

    return weightedMean
        * (
            Number.isFinite(
                futureVolumeFactor
            )
                ? futureVolumeFactor
                : 1
        );
}

// =====================================================
// BUILD PERCENTILE COLOR SCORES
// =====================================================

function calculatePercentileScores()
{
    state.percentileScores.clear();

    const validScores =
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
            function (first, second)
            {
                return first[1]
                    - second[1];
            }
        );

    if (validScores.length === 0)
    {
        return;
    }

    /*
    Percentile rank spreads the 55 segments across the
    full color ramp.

    This prevents a few high outliers from forcing most
    segments into the green portion of the ramp.
    */

    validScores.forEach(
        function (
            entry,
            sortedIndex
        )
        {
            const segmentId =
                entry[0];

            const percentile =
                validScores.length === 1
                    ? 0.5
                    : sortedIndex
                    / (
                        validScores.length - 1
                    );

            state.percentileScores.set(
                segmentId,
                percentile
            );
        }
    );
}

// =====================================================
// RECALCULATE COMBINED SCORES
// =====================================================

function recalculateScores()
{
    state.scores.clear();

    const activeIndexWeights =
        state.indices
        .map(
            function (index)
            {
                return Number(
                    state.indexW[index.id]
                    ?? 0
                );
            }
        )
        .filter(
            function (weight)
            {
                return weight > 0;
            }
        );

    state.hasActiveIndexWeights =
        activeIndexWeights.length > 0;

    /*
    If every index slider is zero, clear the scores and
    draw only the basemap. No default green lines.
    */

    if (!state.hasActiveIndexWeights)
    {
        state.percentileScores.clear();

        statusEl.textContent =
            "All index weights are zero. No scored lines are displayed.";

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
                            state.indexW[index.id]
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
                    If every field within this index is zero,
                    the index is excluded for this segment.
                    */

                    if (
                        indexScore === null
                        ||
                        !Number.isFinite(indexScore)
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
            Segments without an active score are not assigned
            a zero. They are excluded from the rendered lines.
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

    calculatePercentileScores();

    statusEl.textContent =
        `${state.segments.length} segments and `
        + `${state.indices.length} indexes loaded.`;

    draw();
}

// =====================================================
// CREATE STANDARD WEIGHT SLIDER
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
// CREATE BASEMAP SHIFT CONTROLS
// =====================================================

function buildBasemapShiftControls()
{
    const section =
        document.createElement("section");

    section.id =
        "basemapControls";

    const heading =
        document.createElement("h2");

    heading.textContent =
        "Basemap alignment";

    const description =
        document.createElement("p");

    description.textContent =
        "Positive vertical values move the basemap down. The linework remains fixed.";

    description.style.fontSize =
        "12px";

    description.style.color =
        "#52606d";

    description.style.lineHeight =
        "1.35";

    // Vertical shift row

    const verticalContainer =
        document.createElement("div");

    verticalContainer.className =
        "slider";

    const verticalLabel =
        document.createElement("label");

    const verticalName =
        document.createElement("span");

    verticalName.textContent =
        "Vertical shift";

    const verticalOutput =
        document.createElement("output");

    verticalOutput.id =
        "basemapShiftYValue";

    verticalOutput.textContent =
        `${DISPLAY.basemapShiftY}px`;

    verticalLabel.appendChild(
        verticalName
    );

    verticalLabel.appendChild(
        verticalOutput
    );

    const verticalSlider =
        document.createElement("input");

    verticalSlider.id =
        "basemapShiftY";

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

    // Horizontal shift row

    const horizontalContainer =
        document.createElement("div");

    horizontalContainer.className =
        "slider";

    const horizontalLabel =
        document.createElement("label");

    const horizontalName =
        document.createElement("span");

    horizontalName.textContent =
        "Horizontal shift";

    const horizontalOutput =
        document.createElement("output");

    horizontalOutput.id =
        "basemapShiftXValue";

    horizontalOutput.textContent =
        `${DISPLAY.basemapShiftX}px`;

    horizontalLabel.appendChild(
        horizontalName
    );

    horizontalLabel.appendChild(
        horizontalOutput
    );

    const horizontalSlider =
        document.createElement("input");

    horizontalSlider.id =
        "basemapShiftX";

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

    // Zero button

    const zeroButton =
        document.createElement("button");

    zeroButton.type =
        "button";

    zeroButton.textContent =
        "Reset basemap position";

    zeroButton.addEventListener(
        "click",
        function ()
        {
            DISPLAY.basemapShiftX = 0;
            DISPLAY.basemapShiftY = 0;

            horizontalSlider.value =
                "0";

            verticalSlider.value =
                "0";

            horizontalOutput.textContent =
                "0px";

            verticalOutput.textContent =
                "0px";

            draw();
        }
    );

    section.appendChild(
        heading
    );

    section.appendChild(
        description
    );

    section.appendChild(
        verticalContainer
    );

    section.appendChild(
        horizontalContainer
    );

    section.appendChild(
        zeroButton
    );

    /*
    The alignment controls are inserted above the
    index-weight section.
    */

    const firstSection =
        indexWeightsDiv.closest(
            "section"
        );

    firstSection.parentNode.insertBefore(
        section,
        firstSection
    );
}

// =====================================================
// BUILD WEIGHT CONTROLS
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
// CREATE SEGMENT PATH
// =====================================================

function createSegmentPath(segment)
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
    The adjustment is applied only to the basemap.
    This lets you align the image with the fixed linework.
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
    No active indexes means no green fallback lines.
    Only the basemap remains visible.
    */

    if (!state.hasActiveIndexWeights)
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
            Do not draw a segment if it has no calculated
            score under the active slider configuration.
            */

            if (
                !state.scores.has(
                    segment.segmentId
                )
            )
            {
                return;
            }

            const percentile =
                state.percentileScores.get(
                    segment.segmentId
                );

            if (
                !Number.isFinite(
                    percentile
                )
            )
            {
                return;
            }

            // Dark outer casing

            createSegmentPath(
                segment
            );

            ctx.strokeStyle =
                "rgba(45,45,45,0.85)";

            ctx.lineWidth =
                DISPLAY.lineCasingWidth;

            ctx.stroke();

            // Colored line

            createSegmentPath(
                segment
            );

            ctx.strokeStyle =
                colorRamp(
                    percentile
                );

            ctx.lineWidth =
                DISPLAY.scoredLineWidth;

            ctx.stroke();
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

        buildBasemapShiftControls();

        buildControls();

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

# US 83 Need Index Explorer

Ready-to-host static app. The linework groups vertices by Segment ID and sorts by OBJECTID. Five index groups are loaded from the CPT workbook: Freight, Bridges, Pavement, Mobility, and Safety.

## Calculation
Each index is the weighted mean of its available field values, multiplied by Future Volume Factor. Numeric fields with ranges above 1 are divided by their observed maximum before weighting so Bridge Index (EB) is comparable to normalized 0-1 fields. Missing/N/A values are excluded from that segment's denominator. The overall score is the weighted mean of the five recalculated indexes.

## Run
Serve this folder over HTTP, for example `python -m http.server 8000`, or publish it with GitHub Pages. Opening index.html directly with file:// may block JSON fetches.

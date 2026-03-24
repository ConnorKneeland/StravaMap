const auth_link = "https://www.strava.com/oauth/token";
const NUM_PAGES = 30;

var bikeArr = [];
var workoutData = {}; // Store data for the 'Workout Miles by Day' chart
var activityCounts = {}; // Store workout counts per activity type

/*------------------------------------------------------------------------------------------------------------------*/
/*----- Analytics Tab - Add Summary to Chart -----------------------------------------------------------------------*/
/*------------------------------------------------------------------------------------------------------------------*/

function drawSummary() {
  // 1. Human-friendly labels per Strava type
  const labelMap = {
    run: 'Run', trailrun: 'Trail Run', virtualrun: 'Virtual Run', walk: 'Walk',
    ride: 'Cycling', mountainbikeride: 'Mountain Biking', gravelride: 'Gravel Ride',
    ebikeride: 'Cycling', emountainbikeride: 'Mountain Biking', velomobile: 'Velomobile',
    virtualride: 'Virtual Ride', swim: 'Swimming', canoe: 'Canoe', kayak: 'Kayak',
    kitesurf: 'Kitesurf', rowing: 'Rowing', standuppaddling: 'Paddleboarding', surf: 'Surfing', windsurf: 'Windsurf', sail: 'Sailing',
    alpineski: 'Skiing', backcountryski: 'Skiing', nordicski: 'Skiing', snowboard: 'Snowboard', snowshoe: 'Snowshoe',
    iceskate: 'Ice Skate', inlineskate: 'Inline Skate', skateboard: 'Skateboard', rockclimb: 'Rock Climb', rollerski: 'Roller Ski',
    handcycle: 'Handcycle', soccer: 'Soccer', golf: 'Golf', wheelchair: 'Wheelchair',
    badminton: 'Badminton', tennis: 'Tennis', pickleball: 'Pickleball', tabletennis: 'Table Tennis', squash: 'Squash',
    hiit: 'HIIT', pilates: 'Pilates', yoga: 'Yoga',
    // Indoor Training group
    weighttraining: 'Indoor Training', crossfit: 'Indoor Training', elliptical: 'Indoor Training', stairstepper: 'Indoor Training', workout: 'Indoor Training'
  };

  // 2. Color palette: Tableau-inspired distinct colors for each type
  const colorMap = {
    run: '#ff412e', trailrun: '#393b79', virtualrun: '#2ca02c', walk: '#000000',
    ride: '#F28E2B', mountainbikeride: '#9467bd', gravelride: '#8c564b',
    ebikeride: '#e377c2', emountainbikeride: '#7f7f7f', velomobile: '#bcbd22',
    virtualride: '#17becf', swim: '#1f77b4', canoe: '#5254a3',
    kayak: '#6b6ecf', kitesurf: '#9c9ede', rowing: '#637939',
    standuppaddling: '#8ca252', surf: '#b5cf6b', windsurf: '#cedb9c',
    sail: '#8c6d31', alpineski: '#5f99cf', backcountryski: '#5f99cf',
    nordicski: '#5f99cf', snowboard: '#843c39', snowshoe: '#a55194',
    iceskate: '#ce6dbd', inlineskate: '#de9ed6', skateboard: '#1f77b4',
    rockclimb: '#ff7f0e', rollerski: '#2ca02c', handcycle: '#d62728',
    soccer: '#9467bd', golf: '#8c564b', wheelchair: '#e377c2',
    badminton: '#7f7f7f', tennis: '#bcbd22', pickleball: '#17becf',
    tabletennis: '#393b79', squash: '#5254a3', hiit: '#6b6ecf',
    pilates: '#9c9ede', yoga: '#637939', weighttraining: '#8ca252',
    crossfit: '#b5cf6b', elliptical: '#cedb9c', stairstepper: '#8c6d31',
    workout: '#bd9e39',
    default: '#17becf'
  };

  // 3. Calculate total per category label
  const categoryTotals = Object.entries(activityCounts).reduce((acc, [type, count]) => {
    const label = labelMap[type];
    if (label && count > 0) acc[label] = (acc[label] || 0) + count;
    return acc;
  }, {});

  // 4. Sort categories by descending count, then flip for top-to-bottom order
  let categoryOrder = Object.keys(categoryTotals).sort((a, b) => categoryTotals[b] - categoryTotals[a]);
  // Plotly draws in bottom-to-top; reverse to have highest at top
  categoryOrder = categoryOrder.reverse();

  // 5. Build traces for stacking with full-length arrays
  const traces = Object.entries(activityCounts)
    .filter(([type, count]) => count > 0)
    .map(([type, count]) => {
      const label = labelMap[type];
      const x = categoryOrder.map(cat => (cat === label ? count : 0));
      return {
        x,
        y: categoryOrder,
        type: 'bar',
        orientation: 'h',
        marker: { color: colorMap[type] },
        showlegend: false,
        text: x.map(val => (val > 0 ? String(val) : '')),
        textposition: 'inside',
        textfont: { size: 16 }  // Make bar count labels larger
        //,hoverinfo: 'y+text'
      };
    });

  // 6. Layout settings with larger fonts
  const layout = {
    title: { text: 'Total Number of Workouts by Type', font: { size: 30 } },
    barmode: 'stack',
    dragmode: 'pan',
    xaxis: {
      title: { text: 'Workout Count', font: { size: 20 } },
      tickfont: { size: 16 }
    },
    yaxis: {
      automargin: true,
      categoryorder: 'array', categoryarray: categoryOrder,
      tickfont: { size: 18 },
      tickpadding: 15,            
      ticklabelposition: 'outside'
    },
    margin: { l: 200, t: 80, b: 60 },
    showlegend: false
  };

  Plotly.newPlot('activity-summary', traces, layout, { responsive: true });
}

/*------------------------------------------------------------------------------------------------------------------*/
/*------------------------------------------------------------------------------------------------------------------*/
/*------------------------------------------------------------------------------------------------------------------*/


function getMiles(i) {
    return i * 0.000621371192;
}

function getDetailedActivity(activityId, accessToken) {
    const detailedActivityLink = `https://www.strava.com/api/v3/activities/${activityId}?access_token=${accessToken}`;
    
    fetch(detailedActivityLink)
        .then(response => response.json())
        .then(detailedActivity => {
            console.log(detailedActivity); // Log the detailed activity data
        })
        .catch(error => {
            console.error(`Error fetching details for activity ${activityId}:`, error);
        });
}

// Time format function (xx hr xx min xx sec)
function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    let formattedTime = '';
    if (hrs > 0) formattedTime += `${hrs} hr `;
    if (mins > 0) formattedTime += `${mins} min `;
    if (secs > 0 || formattedTime === '') formattedTime += `${secs} sec`;
    return formattedTime.trim();
}

// Convert MPH to minutes per mile pace
function convertMphToPace(mph) {
    const minutesPerMile = 60 / mph;
    const mins = Math.floor(minutesPerMile);
    const secs = Math.round((minutesPerMile - mins) * 60);
    return `${mins} min ${secs} sec per mile`;
}

// Function to handle activity data and collect for chart
function handleActivityData(activity) {
    const date = activity.start_date.split('T')[0]; // Get the date
    let type = activity.type.toLowerCase();
    if (type === 'workout' && activity.sport_type) {
        type = activity.sport_type.toLowerCase();
    }
    const miles = getMiles(activity.distance);

    activityCounts[type] = (activityCounts[type] || 0) + 1;

    if (!workoutData[date]) {
        workoutData[date] = { running: 0, cycling: 0, swimming: 0, walk: 0, snow_sport: 0, other: 0 }; // Add more workout types as needed
    }

    if (type === "run") workoutData[date].running += miles.toFixed(2);
    if (type === "ride") workoutData[date].cycling += miles.toFixed(2);
    if (type === "swim") workoutData[date].swimming += miles.toFixed(2);
    if (type === "walk") workoutData[date].walk += miles.toFixed(2);
    if (type === "alpineski" || type === "backcountryski" || type === "nordicski" || type === "snowboard") workoutData[date].snow_sport += miles.toFixed(2);
    if (type === "kayaking" || type === "golf" || type === "standuppaddling") workoutData[date].other += miles.toFixed(2);
} 






async function getActivities(res){

    const isMobile = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const LINE_WEIGHT = isMobile ? 5 : 2.5; // thicker polylines on mobile
    const OPACITY_WEIGHT = isMobile ? 0.5 : 0.8; // more visible polylines on mobile

    console.log(isMobile)
    console.log(LINE_WEIGHT)

    let lat = 44.434750, lng = -88.067890;

    try {
        const url = `https://www.strava.com/api/v3/athlete/activities` +
                    `?access_token=${res.access_token}&per_page=1&page=1`;
        const [latest] = await fetch(url).then(r => r.json());

        if (Array.isArray(latest?.start_latlng) && latest.start_latlng.length === 2) {
        [lat, lng] = latest.start_latlng; 
        }
    } catch (e) {
        console.warn('Using fallback centre:', e);
    }

    console.log(lat);
    console.log(lng);

    const map = L.map('map').setView([lat, lng], 8);
    window.addEventListener('resize', () => map.invalidateSize());

    setTimeout(() => {
         map.flyTo(map.getCenter(), 13, { animate: true, duration: 1.95 });
    }, 3200);

    // Dads
    /*var map = L.map('map').setView([44.434750, -88.067890], 12);
    window.addEventListener('resize', function () {
        map.invalidateSize(); // Ensures the map resizes properly when the window is resized
    });*/

    L.tileLayer('https://api.mapbox.com/styles/v1/ckneeland/clczd9zd6001515pj5yvlalza/tiles/{z}/{x}/{y}?access_token={accessToken}', {
        attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
        maxZoom: 18,
        id: 'mapbox/streets-v11',
        tileSize: 512,
        zoomOffset: -1,
        accessToken: 'pk.eyJ1IjoiY2tuZWVsYW5kIiwiYSI6ImNsY3pkNW8wdDAxcWozd21lMGhvczFuMHcifQ.GhhJgb3cpjIvHf8tz-gCFw'
    }).addTo(map);

    var count = 0;

    // Get 200 * i records
     for(var i = 1; i <= NUM_PAGES; i++){
        count = count + 1;
        console.log(i);
        const activities_link = `https://www.strava.com/api/v3/athlete/activities?access_token=${res.access_token}&per_page=200&page=${i}`;
        fetch(activities_link)
            .then((res) => res.json())
            .then(function (data){

                for(var x = 0; x < data.length; x++){
                    var coordinates = L.Polyline.fromEncoded(data[x].map.summary_polyline).getLatLngs();
                    var polyline;
                    console.log(data[x]);
                    
                    // Fetch and log detailed activity information
                    //const activityId = data[x].id;
                    //getDetailedActivity(activityId, res.access_token);

                    handleActivityData(data[x]); // Collect data for the chart
    
                    if(data[x].type === "Run"){

                        // Drawing Polyline
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "red",
                                weight: LINE_WEIGHT,
                                opacity: OPACITY_WEIGHT,
                                lineJoin: 'round'
                            }
                        ).addTo(map)

                        // Creating Tooltip for Polyline
                        polyline.bindTooltip("<div style='display: flex; align-items: flex-start; flex-direction: column;'><b style='font-size: 20px;'>" + data[x].name + "</b>" + 
                        "<h2>On " + formatDate(data[x].start_date) + "</h2>" +
                        "<h3 style='margin-top: -5px;'><b> Workout: </b>" + data[x].type + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Distance: </b>" + getMiles(data[x].distance).toFixed(2) + " miles</h3>" +

                        `<h3 style='margin-top: -5px;'><b> Time: </b>${formatTime(data[x].elapsed_time)}</h3>
                        <h3 style='margin-top: -5px;'><b> Avg. Pace: </b>${convertMphToPace(data[x].average_speed * 2.2369362920544)}</h3>
                        <h3 style='margin-top: -5px;'><b> Max Pace: </b>${convertMphToPace(data[x].max_speed * 2.2369362920544)}</h3></div>`
                        //"<h3 style='margin-top: -5px;'><b> Time: </b>" + (data[x].elapsed_time/3600).toFixed(2) + " hours</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Elevation Gain: </b>" + ((data[x].elev_high - data[x].elev_low) * 3.28084).toFixed(2) + " feet</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Elevation High: </b>" + (data[x].elev_high * 3.28084).toFixed(2) + " feet</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Elevation Low: </b>" + (data[x].elev_low * 3.28084).toFixed(2) + " feet</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Avg. HR: </b>" + data[x].average_heartrate + "</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Max HR: </b>" + data[x].max_heartrate + "</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>" + (data[x].average_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Max Speed: </b>" + (data[x].max_speed * 2.2369362920544).toFixed(2) + " mph</h3></div>", 
                        ,{permanent: false, sticky: true, className: 'left-align'}).openTooltip
                    }
                    else if(data[x].type === "Ride"){
                        polyline = L.polyline(
                            coordinates,
                            {
                                //color: "#F28E2B",f9830d
                                color: "#ff8000ff",
                                weight: LINE_WEIGHT,
                                opacity: OPACITY_WEIGHT,
                                lineJoin: 'round'
                            }
                        ).addTo(map)

                        // Creating Tooltip for Polyline
                        polyline.bindTooltip("<div style='display: flex; align-items: flex-start; flex-direction: column;'><b style='font-size: 20px;'>" + data[x].name + "</b>" + 
                        "<h2>On " + formatDate(data[x].start_date) + "</h2>" +
                        "<h3><b> Workout: </b>" + data[x].type + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Distance: </b>" + getMiles(data[x].distance).toFixed(2) + " miles</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Time: </b>" + (data[x].elapsed_time/3600).toFixed(2) + " hours</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>" + (data[x].average_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Speed: </b>" + (data[x].max_speed * 2.2369362920544).toFixed(2) + " mph</h3>", 
                        "<h3 style='margin-top: -5px;'><b> Elevation Gain: </b>" + ((data[x].elev_high - data[x].elev_low) * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation High: </b>" + (data[x].elev_high * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation Low: </b>" + (data[x].elev_low * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Cadence: </b>" + data[x].average_cadence + " RPM</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Watts: </b>" + data[x].average_watts + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Total kJ: </b>" + data[x].kilojoules + "</h3></div>",
                        //"<h3 style='margin-top: -5px;'><b> Avg. HR: </b>" + data[x].average_heartrate + " bpm</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Max HR: </b>" + data[x].max_heartrate + " bpm</h3>" +
                        
                        {permanent: false, sticky: true, className: 'left-align'}).openTooltip

                        bikeArr.push(data[x]);
                    }
                    else if(data[x].type === "Swim"){
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "#1648ebff",
                                weight: LINE_WEIGHT,
                                opacity: OPACITY_WEIGHT,
                                lineJoin: 'round'
                            }
                        ).addTo(map)

                        // Creating Tooltip for Polyline
                        polyline.bindTooltip("<div style='display: flex; align-items: flex-start; flex-direction: column;'><b style='font-size: 20px;'>" + data[x].name + "</b>" + 
                        "<h2>On " + formatDate(data[x].start_date) + "</h2>" +
                        "<h3><b> Workout: </b>" + data[x].type + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Distance: </b>" + getMiles(data[x].distance).toFixed(2) + " miles</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Time: </b>" + (data[x].elapsed_time/3600).toFixed(2) + " hours</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Strokes Per Min: </b>" + data[x].average_cadence + "</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Avg. HR: </b>" + data[x].average_heartrate + " bpm</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Max HR: </b>" + data[x].max_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>" + (data[x].average_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Speed: </b>" + (data[x].max_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Laps Per Minute: </b>" + ((data[x].average_speed * 60) / 25).toFixed(1) + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Laps Per Minute: </b>" + ((data[x].max_speed * 60) / 25).toFixed(1) + "</h3></div>", 
                        {permanent: false, sticky: true, className: 'left-align'}).openTooltip
                    }
                    else if(data[x].type === "AlpineSki" || data[x].type === "BackcountrySki" || data[x].type === "NordicSki" || data[x].type === "Snowboard"){
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "#5f99cf",
                                weight: LINE_WEIGHT,
                                opacity: OPACITY_WEIGHT,
                                lineJoin: 'round'
                            }
                        ).addTo(map)

                        //console.log(data[x]);

                        // Creating Tooltip for Polyline
                        polyline.bindTooltip("<div style='display: flex; align-items: flex-start; flex-direction: column;'><b style='font-size: 20px;'>" + data[x].name + "</b>" + 
                        "<h2>On " + formatDate(data[x].start_date) + "</h2>" +
                        "<h3><b> Workout: </b>" + data[x].type + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Distance: </b>" + getMiles(data[x].distance).toFixed(2) + " miles</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Time: </b>" + (data[x].elapsed_time/3600).toFixed(2) + " hours</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>" + (data[x].average_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Speed: </b>" + (data[x].max_speed * 2.2369362920544).toFixed(2) + " mph</h3>", 
                        "<h3 style='margin-top: -5px;'><b> Elevation Gain: </b>" + ((data[x].elev_high - data[x].elev_low) * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation High: </b>" + (data[x].elev_high * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation Low: </b>" + (data[x].elev_low * 3.28084).toFixed(2) + " feet</h3></div>",
                        //"<h3 style='margin-top: -5px;'><b> Avg. HR: </b>" + data[x].average_heartrate + " bpm</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Max HR: </b>" + data[x].max_heartrate + " bpm</h3>" +
                        {permanent: false, sticky: true, className: 'left-align'}).openTooltip
                    }
                    else if(data[x].type === "Golf"){
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "#0a7b0a",
                                weight: LINE_WEIGHT,
                                opacity: OPACITY_WEIGHT,
                                lineJoin: 'round'
                            }
                        ).addTo(map)

                        //console.log(data[x]);

                        // Creating Tooltip for Polyline
                        polyline.bindTooltip("<div style='display: flex; align-items: flex-start; flex-direction: column;'><b style='font-size: 20px;'>" + data[x].name + "</b>" + 
                        "<h2>On " + formatDate(data[x].start_date) + "</h2>" +
                        "<h3><b> Workout: </b>" + data[x].type + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Distance: </b>" + getMiles(data[x].distance).toFixed(2) + " miles</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Time: </b>" + (data[x].elapsed_time/3600).toFixed(2) + " hours</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Avg. HR: </b>" + data[x].average_heartrate + " bpm</h3>" +
                        //"<h3 style='margin-top: -5px;'><b> Max HR: </b>" + data[x].max_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>" + (data[x].average_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Speed: </b>" + (data[x].max_speed * 2.2369362920544).toFixed(2) + " mph</h3></div>",
                        {permanent: false, sticky: true, className: 'left-align'}).openTooltip
                    }
                    else if(data[x].type === "Walk"){
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "#000000",
                                weight: LINE_WEIGHT,
                                opacity: OPACITY_WEIGHT,
                                lineJoin: 'round'
                            }
                        ).addTo(map)

                        //console.log(data[x]);

                        // Creating Tooltip for Polyline
                        polyline.bindTooltip("<div style='display: flex; align-items: flex-start; flex-direction: column;'><b style='font-size: 20px;'>" + data[x].name + "</b>" + 
                            "<h2>On " + formatDate(data[x].start_date) + "</h2>" +
                            "<h3 style='margin-top: -5px;'><b> Workout: </b>" + data[x].type + "</h3>" +
                            "<h3 style='margin-top: -5px;'><b> Distance: </b>" + getMiles(data[x].distance).toFixed(2) + " miles</h3>" +
    
                            `<h3 style='margin-top: -5px;'><b> Time: </b>${formatTime(data[x].elapsed_time)}</h3>
                            <h3 style='margin-top: -5px;'><b> Avg. Pace: </b>${convertMphToPace(data[x].average_speed * 2.2369362920544)}</h3>
                            <h3 style='margin-top: -5px;'><b> Max Pace: </b>${convertMphToPace(data[x].max_speed * 2.2369362920544)}</h3>
                            <h3 style='margin-top: -5px;'><b> Elevation Gain: </b>${((data[x].elev_high - data[x].elev_low) * 3.28084).toFixed(2)} feet</h3></div>`
                            ,{permanent: false, sticky: true, className: 'left-align'}).openTooltip
                    }
                    else{
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "purple",
                                weight: LINE_WEIGHT,
                                opacity: OPACITY_WEIGHT,
                                lineJoin: 'round'
                            }
                        ).addTo(map)

                        //console.log(data[x]);

                        // Creating Tooltip for Polyline
                        polyline.bindTooltip("<div style='display: flex; align-items: flex-start; flex-direction: column;'><b style='font-size: 20px;'>" + data[x].name + "</b>" + 
                            "<h2>On " + formatDate(data[x].start_date) + "</h2>" +
                            "<h3 style='margin-top: -5px;'><b> Workout: </b>" + data[x].type + "</h3>" +
                            "<h3 style='margin-top: -5px;'><b> Distance: </b>" + getMiles(data[x].distance).toFixed(2) + " miles</h3>" +
    
                            `<h3 style='margin-top: -5px;'><b> Time: </b>${formatTime(data[x].elapsed_time)}</h3>
                            <h3 style='margin-top: -5px;'><b> Avg. Pace: </b>${convertMphToPace(data[x].average_speed * 2.2369362920544)}</h3>
                            <h3 style='margin-top: -5px;'><b> Max Pace: </b>${convertMphToPace(data[x].max_speed * 2.2369362920544)}</h3></div>`
                            ,{permanent: false, sticky: true, className: 'left-align'}).openTooltip
                    }

                    // Add event listener to increase size of line on user hover
                    polyline.on('mouseover', (function(polyline) {
                        return function() {
                            polyline.setStyle({ weight: 15, opacity: 0.5 });
                        }
                    })(polyline));

                    // Similarily, an event listener to decrease the size of line when the user pulls away
                    polyline.on('mouseout', (function(polyline) {
                        return function() {
                            polyline.setStyle({ weight: LINE_WEIGHT, opacity: OPACITY_WEIGHT });
                        }
                    })(polyline));
                }
    
            })
    }
    console.log(count + 'objects on map');
    // Create visualization for Bike Miles by Month

}

// // Quinns
// function reAuthorize(){
//     fetch(auth_link, {
//         method: 'post',
//         headers: {
//             'Accept': 'application/json, text/plain, */*',
//             'Content-Type': 'application/json'
//         },
//         body: JSON.stringify({
//             client_id: '100558',
//             client_secret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910',
//             refresh_token: '93bfb1298cb4e356053a8116127327d78a607608',
//             grant_type: 'refresh_token'
//         })
//     }).then(res => res.json())
//         .then(res => getActivities(res))
// }

// Dads
function reAuthorize(){
    fetch(auth_link, {
        method: 'post',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            client_id: '100558',
            client_secret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910',
            refresh_token: 'fd40d09e3d95895eda12334f5a6254db341ac516',
            grant_type: 'refresh_token'
        })
    }).then(res => res.json())
        .then(res => getActivities(res))
}

reAuthorize()

function formatDate(dateString) {
    const date = new Date(dateString);
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const day = date.getDate();
    const monthIndex = date.getMonth();
    const year = date.getFullYear();
    const daySuffix = (day % 10 === 1 && day !== 11) ? 'st' : (day % 10 === 2 && day !== 12) ? 'nd' : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
    return `${monthNames[monthIndex]} ${day}${daySuffix}, ${year}`;
}
  
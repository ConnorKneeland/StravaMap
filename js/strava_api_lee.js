function getMiles(i) {
    return i * 0.000621371192;
}

var bikeArr = [];

const auth_link = "https://www.strava.com/oauth/token"

function getActivities(res){

    // Create Map

    // Quinns
    //var map = L.map('map').setView([43.034, -87.912], 12);

    // Dads
    var map = L.map('map').setView([39.6351, -106.5221], 12);
    
    // L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    //     attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    // }).addTo(map);

    //clczdbh38001615pdfug7c1r2
    //clczd9zd6001515pj5yvlalza

    L.tileLayer('https://api.mapbox.com/styles/v1/ckneeland/clczd9zd6001515pj5yvlalza/tiles/{z}/{x}/{y}?access_token={accessToken}', {
        attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
        maxZoom: 18,
        id: 'mapbox/streets-v11',
        tileSize: 512,
        zoomOffset: -1,
        accessToken: 'pk.eyJ1IjoiY2tuZWVsYW5kIiwiYSI6ImNsY3pkNW8wdDAxcWozd21lMGhvczFuMHcifQ.GhhJgb3cpjIvHf8tz-gCFw'
    }).addTo(map);

    // Get 200 * i records
    for(var i = 1; i < 13; i++){
        const activities_link = `https://www.strava.com/api/v3/athlete/activities?access_token=${res.access_token}&per_page=200&page=${i}`;
        fetch(activities_link)
            .then((res) => res.json())
            .then(function (data){

                for(var x = 0; x < data.length; x++){
                    var coordinates = L.Polyline.fromEncoded(data[x].map.summary_polyline).getLatLngs();
                    var polyline;
                    //console.log(data[x])
    
                    if(data[x].type === "Run"){

                        // Drawing Polyline
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "red",
                                weight: 2.5,
                                opacity: 0.6,
                                lineJoin: 'round'
                            }
                        ).addTo(map)

                        // Creating Tooltip for Polyline
                        polyline.bindTooltip("<div style='display: flex; align-items: flex-start; flex-direction: column;'><b style='font-size: 20px;'>" + data[x].name + "</b>" + 
                        "<h2>On " + formatDate(data[x].start_date) + "</h2>" +
                        "<h3 style='margin-top: -5px;'><b> Workout: </b>" + data[x].type + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Distance: </b>" + getMiles(data[x].distance).toFixed(2) + " miles</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Time: </b>" + (data[x].elapsed_time/3600).toFixed(2) + " hours</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation Gain: </b>" + ((data[x].elev_high - data[x].elev_low) * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation High: </b>" + (data[x].elev_high * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation Low: </b>" + (data[x].elev_low * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. HR: </b>" + data[x].average_heartrate + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max HR: </b>" + data[x].max_heartrate + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>" + (data[x].average_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Speed: </b>" + (data[x].max_speed * 2.2369362920544).toFixed(2) + " mph</h3></div>", 
                        {permanent: false, sticky: true, className: 'left-align'}).openTooltip
                    }
                    else if(data[x].type === "Ride"){
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "darkorange",
                                weight: 3,
                                opacity: 0.5,
                                lineJoin: 'round'
                            }
                        ).addTo(map)

                        // Creating Tooltip for Polyline
                        polyline.bindTooltip("<div style='display: flex; align-items: flex-start; flex-direction: column;'><b style='font-size: 20px;'>" + data[x].name + "</b>" + 
                        "<h2>On " + formatDate(data[x].start_date) + "</h2>" +
                        "<h3><b> Workout: </b>" + data[x].type + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Distance: </b>" + getMiles(data[x].distance).toFixed(2) + " miles</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Time: </b>" + (data[x].elapsed_time/3600).toFixed(2) + " hours</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation Gain: </b>" + ((data[x].elev_high - data[x].elev_low) * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation High: </b>" + (data[x].elev_high * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation Low: </b>" + (data[x].elev_low * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Cadence: </b>" + data[x].average_cadence + " RPM</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Watts: </b>" + data[x].average_watts + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Total kJ: </b>" + data[x].kilojoules + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. HR: </b>" + data[x].average_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max HR: </b>" + data[x].max_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>" + (data[x].average_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Speed: </b>" + (data[x].max_speed * 2.2369362920544).toFixed(2) + " mph</h3></div>", 
                        {permanent: false, sticky: true, className: 'left-align'}).openTooltip

                        bikeArr.push(data[x]);
                    }
                    else if(data[x].type === "Swim"){
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "blue",
                                weight: 3,
                                opacity: 0.7,
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
                        "<h3 style='margin-top: -5px;'><b> Avg. HR: </b>" + data[x].average_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max HR: </b>" + data[x].max_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>" + (data[x].average_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Speed: </b>" + (data[x].max_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Laps Per Minute: </b>" + ((data[x].average_speed * 60) / 25).toFixed(1) + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Laps Per Minute: </b>" + ((data[x].max_speed * 60) / 25).toFixed(1) + "</h3></div>", 
                        {permanent: false, sticky: true, className: 'left-align'}).openTooltip
                    }
                    else if(data[x].type === "AlpineSki" || data[x].type === "BackcountrySki" || data[x].type === "NordicSki"){
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "#5f99cf",
                                weight: 3,
                                opacity: 0.7,
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
                        "<h3 style='margin-top: -5px;'><b> Elevation Gain: </b>" + ((data[x].elev_high - data[x].elev_low) * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation High: </b>" + (data[x].elev_high * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Elevation Low: </b>" + (data[x].elev_low * 3.28084).toFixed(2) + " feet</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. HR: </b>" + data[x].average_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max HR: </b>" + data[x].max_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>" + (data[x].average_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Speed: </b>" + (data[x].max_speed * 2.2369362920544).toFixed(2) + " mph</h3></div>",
                        {permanent: false, sticky: true, className: 'left-align'}).openTooltip
                    }
                    else if(data[x].type === "Golf"){
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "#0a7b0a",
                                weight: 3,
                                opacity: 0.7,
                                lineJoin: 'round'
                            }
                        ).addTo(map)

                        console.log(data[x]);

                        // Creating Tooltip for Polyline
                        polyline.bindTooltip("<div style='display: flex; align-items: flex-start; flex-direction: column;'><b style='font-size: 20px;'>" + data[x].name + "</b>" + 
                        "<h2>On " + formatDate(data[x].start_date) + "</h2>" +
                        "<h3><b> Workout: </b>" + data[x].type + "</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Distance: </b>" + getMiles(data[x].distance).toFixed(2) + " miles</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Time: </b>" + (data[x].elapsed_time/3600).toFixed(2) + " hours</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. HR: </b>" + data[x].average_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max HR: </b>" + data[x].max_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>" + (data[x].average_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Speed: </b>" + (data[x].max_speed * 2.2369362920544).toFixed(2) + " mph</h3></div>",
                        {permanent: false, sticky: true, className: 'left-align'}).openTooltip
                    }
                    else{
                        polyline = L.polyline(
                            coordinates,
                            {
                                color: "purple",
                                weight: 3,
                                opacity: 0.7,
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
                        "<h3 style='margin-top: -5px;'><b> Avg. HR: </b>" + data[x].average_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max HR: </b>" + data[x].max_heartrate + " bpm</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>" + (data[x].average_speed * 2.2369362920544).toFixed(2) + " mph</h3>" +
                        "<h3 style='margin-top: -5px;'><b> Max Speed: </b>" + (data[x].max_speed * 2.2369362920544).toFixed(2) + " mph</h3></div>",
                        {permanent: false, sticky: true, className: 'left-align'}).openTooltip
                    }

                    // Add event listener to increase size of line on user hover
                    polyline.on('mouseover', (function(polyline) {
                        return function() {
                            polyline.setStyle({ weight: 10, opacity: 0.9 });
                        }
                    })(polyline));

                    // Similarily, an event listener to decrease the size of line when the user pulls away
                    polyline.on('mouseout', (function(polyline) {
                        return function() {
                            polyline.setStyle({ weight: 3, opacity: 0.7 });
                        }
                    })(polyline));
                }
    
            })
    }

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

// Lee: ad283617bf3f3a20d232e470562c8b1e569e2260
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
            refresh_token: '6568dbed5af3c4fa40e7dabc6f5768039e2cb53d',
            grant_type: 'refresh_token'
        })
    }).then(res => res.json())
        .then(res => getActivities(res))
}

reAuthorize()

function formatDate(dateString) {
    const date = new Date(dateString);
    const monthNames = [
      "January", "February", "March",
      "April", "May", "June", "July",
      "August", "September", "October",
      "November", "December"
    ];
    const day = date.getDate();
    const monthIndex = date.getMonth();
    const year = date.getFullYear();
  
    const daySuffix = (day % 10 === 1 && day !== 11) ? 'st' :
                      (day % 10 === 2 && day !== 12) ? 'nd' :
                      (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
  
    return `${monthNames[monthIndex]} ${day}${daySuffix}, ${year}`;
  }
  
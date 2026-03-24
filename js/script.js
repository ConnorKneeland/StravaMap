function getMiles(i) {
  return i * 0.000621371192;
}

const auth_user = 'https://www.strava.com/oauth/authorize?client_id=100558&redirect_uri=http://localhost&response_type=code&scope=activity:read';
// the above link is how end user authroizes. This will be done once manually then we will use token/refresh token
const auth_link = 'https://www.strava.com/oauth/token';
// above link used for getting token and refreshing token
//const activites_link = 'https://www.strava.com/api/v3/athlete/activities?access_token=xxxx'
// above link used for getting activites 

var runArr = [];
var swimArr = [];
var bikeArr = [];
var otherArr = [];

function getActivites(code) {
  //console.log(code)

  var mymap = L.map('mapid').setView([43.03385236300528, -87.9123867675662], 10);
      L.tileLayer('https://api.mapbox.com/styles/v1/ckneeland/clczd9zd6001515pj5yvlalza/tiles/{z}/{x}/{y}?access_token={accessToken}', {
        attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
        maxZoom: 22,
        id: 'mapbox/streets-v11',
        tileSize: 512,
        zoomOffset: -1,
        accessToken: 'pk.eyJ1IjoiY2tuZWVsYW5kIiwiYSI6ImNsY3pkNW8wdDAxcWozd21lMGhvczFuMHcifQ.GhhJgb3cpjIvHf8tz-gCFw'
    }).addTo(mymap);

      
      var run_color = "red";
      var weight = 5;
  // Get 200 * i records
  for(var i = 1; i < 2; i++){
    const activites_link = `https://www.strava.com/api/v3/athlete/activities?access_token=${code.access_token}&per_page=200&page=${i}`;
  
    fetch(activites_link)
      .then((res) => res.json())
      //.then(res => console.log(res));
      .then(function (data) {

        for(var x = 0; x < data.length; x++){
            var coordinates = L.Polyline.fromEncoded(data[x].map.summary_polyline).getLatLngs()
            console.log(data[x])

            if(data[x].type === "Run"){
                L.polyline(
                    coordinates,
                    {
                        color: "red",
                        weight: 2.5,
                        opacity: 0.6,
                        lineJoin: 'round'
                    }
                ).addTo(mymap)
                runArr.push(data[x])
            }
            else if(data[x].type === "Ride" || data[x].type === "VirtualRide"){
                L.polyline(
                    coordinates,
                    {
                        color: "darkorange",
                        weight: 3,
                        opacity: 0.5,
                        lineJoin: 'round'
                    }
                ).addTo(mymap)
                bikeArr.push(data[x])
            }
            else if(data[x].type === "Swim"){
                L.polyline(
                    coordinates,
                    {
                        color: "blue",
                        weight: 3,
                        opacity: 0.7,
                        lineJoin: 'round'
                    }
                ).addTo(mymap)
                swimArr.push(data[x])
            }
            else{
                L.polyline(
                    coordinates,
                    {
                        color: "purple",
                        weight: 3,
                        opacity: 0.7,
                        lineJoin: 'round'
                    }
                ).addTo(mymap)
                otherArr.push(data[x])
            }
        }
      })
      .catch(function (error) {
        console.log(error);
      });
  }
}

function reAuthorize() {
  fetch(auth_link, {
    method: 'post',

    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({

      client_id: '100558',
      client_secret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910',
      refresh_token: '93bfb1298cb4e356053a8116127327d78a607608',
      grant_type: 'refresh_token'

    })

  }).then(res => res.json())
    .then(res => getActivites(res))
}

reAuthorize()
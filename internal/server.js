const path = require('path');
const express = require('express');

var app = express();
app.use('/content', express.static(path.join(__dirname, '../content/')));
app.use('/internal', express.static(__dirname));
app.use('/views', express.static(path.join(__dirname, '../views/')));

// NOTE: Ugh this is super hacky. We need this express app to not suck.
app.use('//views', express.static(path.join(__dirname, '../views/')));
app.use('///views', express.static(path.join(__dirname, '../views/')));
app.use('////views', express.static(path.join(__dirname, '../views/')));

app.use('/podspec.yaml', express.static(path.join(__dirname, '../podspec.yaml')));
app.use('/routes.yaml', express.static(path.join(__dirname, '../routes.yaml')));
app.get('*', function(req, res) {
  res.sendFile(__dirname + '/grow.html');
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log(`App listening on port ${PORT}`);
  console.log('Press Ctrl+C to quit.');
});

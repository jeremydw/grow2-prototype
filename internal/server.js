const path = require('path');
const express = require('express');

var app = express();
app.use('/content', express.static(path.join(__dirname, '../content/')));
app.use('/views', express.static(path.join(__dirname, '../views/')));
app.use('/internal', express.static(__dirname));
app.get('/*', function(req, res) {
  res.sendFile(__dirname + '/grow.html');
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log(`App listening on port ${PORT}`);
  console.log('Press Ctrl+C to quit.');
});

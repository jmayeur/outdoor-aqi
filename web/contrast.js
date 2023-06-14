const colourStrToRGB = function(colour) {
  colour = colour.toLowerCase();

  if (colour.substring(0, 3) === 'rgb') {
      // rgb[a](0, 0, 0[, 0]) format.
      var matches = /^rgba?\s*\((\d+),\s*(\d+),\s*(\d+)([^)]*)\)$/.exec(colour);
      colour = {
          red: (matches[1] / 255),
          green: (matches[2] / 255),
          blue: (matches[3] / 255)
      }
  } else {
      // Hex digit format.
      if (colour.charAt(0) === '#') {
          colour = colour.substr(1);
      }

      if (colour.length === 3) {
          colour = colour.replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3');
      }

      colour = {
          red: (parseInt(colour.substr(0, 2), 16) / 255),
          green: (parseInt(colour.substr(2, 2), 16) / 255),
          blue: (parseInt(colour.substr(4, 2), 16) / 255)
      };
  }

  return colour;
};

const relativeLum = function(colour) {
  if (colour.charAt) {
      var colour = colourStrToRGB(colour);
  }

  var transformed = {};
  for (var x in colour) {
      if (colour[x] <= 0.03928) {
          transformed[x] = colour[x] / 12.92;
      } else {
          transformed[x] = Math.pow(((colour[x] + 0.055) / 1.055), 2.4);
      }
  }//end for

  var lum = ((transformed.red * 0.2126) + (transformed.green * 0.7152) + (transformed.blue * 0.0722));
  return lum;
}

const contrastRatio = function(colour1, colour2) {
  var ratio = (0.05 + relativeLum(colour1)) / (0.05 + relativeLum(colour2));
  if (ratio < 1) {
      ratio = 1 / ratio;
  }

  return ratio;
};

function contrast(yourColor) {
  var black = "#000000";
  var white = "#ffffff";
  return contrastRatio(yourColor, black) > contrastRatio(yourColor, white) ? 'black' : 'white';
}
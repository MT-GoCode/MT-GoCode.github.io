document.getElementById('tardis-img').addEventListener('click', function() {
    window.location.href = '/interior/about-me';
});

let angle = 0; // Starting angle
const radius = 20; // Radius of the circle

function moveTardisInCircle() {
    const tardisImg = document.getElementById('tardis-img');
    // Calculate the new position
    const xPos = radius * Math.cos(angle);
    const yPos = radius * Math.sin(angle);
    // Apply the new position
    tardisImg.style.transform = `translate(${xPos}px, ${yPos}px)`;
    // Increment the angle for the next frame
    angle += 0.01; // Adjust this value to control the speed of the rotation
}

// Call moveTardisInCircle periodically to create the animation
setInterval(moveTardisInCircle, 20); // Adjust the interval for different speeds

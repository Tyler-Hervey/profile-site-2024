// 80s-arcade deep-space scene: a dithered spiral galaxy in the portrait's blue,
// stars drifting slowly toward the viewer out of the galaxy, and the occasional
// shooting star. Everything is drawn into a low-resolution pixel buffer and
// scaled up with nearest-neighbor so every "art pixel" is a chunky square.

type RgbColor = readonly [number, number, number]

interface Star {
  // Position on the far plane, -1..1 of the canvas span around the galaxy.
  farPlaneX: number
  farPlaneY: number
  // 1 is the far plane; the star passes the viewer at NEAREST_STAR_DEPTH.
  depth: number
  packedColor: number
  blinkRadiansPerSecond: number
  blinkPhase: number
  isSparkle: boolean
}

interface ShootingStar {
  x: number
  y: number
  velocityX: number
  velocityY: number
}

interface GalaxyLayout {
  centerX: number
  centerY: number
  radius: number
}

const CSS_PIXELS_PER_ART_PIXEL = 3
const TARGET_FRAMES_PER_SECOND = 30
const ART_PIXELS_PER_STAR = 85

const NEAREST_STAR_DEPTH = 0.12
const STAR_DEPTH_PER_SECOND = 0.035
const DIM_STAR_DEPTH = 0.8
const CLOSE_STAR_DEPTH = 0.3

const BACKGROUND_COLOR: RgbColor = [5, 5, 5]
const ACCENT_BLUE: RgbColor = [122, 122, 255]
const DIM_BLUE: RgbColor = [70, 70, 160]
const PALE_BLUE: RgbColor = [190, 190, 255]
const WHITE: RgbColor = [255, 255, 255]
const ARCADE_YELLOW: RgbColor = [255, 214, 102]
const ARCADE_PINK: RgbColor = [255, 107, 157]

const STAR_COLORS_BY_WEIGHT: ReadonlyArray<readonly [RgbColor, number]> = [
  [WHITE, 6],
  [PALE_BLUE, 4],
  [ACCENT_BLUE, 3],
  [ARCADE_YELLOW, 1],
  [ARCADE_PINK, 1],
]

// 4x4 ordered-dither thresholds, the same technique as the portrait.
const BAYER_THRESHOLDS = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((rank) => (rank + 0.5) / 16))

const GALAXY_ARM_COUNT = 2
const GALAXY_ARM_TWIST = 6.5
const GALAXY_TILT = 0.42
const GALAXY_INCLINATION_RADIANS = -0.38
const GALAXY_RADIANS_PER_SECOND = 0.05

function createSeededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function pickWeightedStarColor(random: () => number): RgbColor {
  const totalWeight = STAR_COLORS_BY_WEIGHT.reduce((sum, [, weight]) => sum + weight, 0)
  let remaining = random() * totalWeight
  for (const [color, weight] of STAR_COLORS_BY_WEIGHT) {
    remaining -= weight
    if (remaining <= 0) return color
  }
  return WHITE
}

function packColor([red, green, blue]: RgbColor) {
  // ImageData is RGBA in memory; read as a little-endian Uint32 that is ABGR.
  return ((255 << 24) | (blue << 16) | (green << 8) | red) >>> 0
}

function createStar(random: () => number, depth: number): Star {
  const isBlinking = random() < 0.6
  return {
    farPlaneX: random() * 2 - 1,
    farPlaneY: random() * 2 - 1,
    depth,
    packedColor: packColor(pickWeightedStarColor(random)),
    blinkRadiansPerSecond: isBlinking ? 1.5 + random() * 4 : 0,
    blinkPhase: random() * Math.PI * 2,
    isSparkle: random() < 0.3,
  }
}

export function startStarfield(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  const container = canvas.parentElement
  if (!context || !container) return

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const backgroundPacked = packColor(BACKGROUND_COLOR)
  const accentPacked = packColor(ACCENT_BLUE)
  const dimBluePacked = packColor(DIM_BLUE)
  const palePacked = packColor(PALE_BLUE)
  const whitePacked = packColor(WHITE)

  let artWidth = 0
  let artHeight = 0
  let imageData: ImageData | null = null
  let pixelBuffer = new Uint32Array(0)
  let galaxy: GalaxyLayout = { centerX: 0, centerY: 0, radius: 0 }
  let stars: Star[] = []
  let shootingStar: ShootingStar | null = null
  let secondsUntilNextShootingStar = 4
  let animationFrameId = 0
  let isOnScreen = true
  let startTimestamp = 0
  let lastDrawnTimestamp = 0

  function setPixel(x: number, y: number, packedColor: number) {
    const column = Math.floor(x)
    const row = Math.floor(y)
    if (column < 0 || row < 0 || column >= artWidth || row >= artHeight) return
    pixelBuffer[row * artWidth + column] = packedColor
  }

  function resize() {
    const devicePixelRatio = window.devicePixelRatio || 1
    // Snap each art pixel to whole device pixels so the squares stay even.
    const devicePixelsPerArtPixel = Math.max(1, Math.round(CSS_PIXELS_PER_ART_PIXEL * devicePixelRatio))
    const cssPixelsPerArtPixel = devicePixelsPerArtPixel / devicePixelRatio

    artWidth = Math.ceil(container!.clientWidth / cssPixelsPerArtPixel)
    artHeight = Math.ceil(container!.clientHeight / cssPixelsPerArtPixel)
    if (artWidth === 0 || artHeight === 0) return

    canvas.width = artWidth
    canvas.height = artHeight
    canvas.style.width = `${artWidth * cssPixelsPerArtPixel}px`
    canvas.style.height = `${artHeight * cssPixelsPerArtPixel}px`

    imageData = context!.createImageData(artWidth, artHeight)
    pixelBuffer = new Uint32Array(imageData.data.buffer)

    const isNarrowScreen = artWidth < 200
    galaxy = {
      centerX: artWidth * (isNarrowScreen ? 0.74 : 0.78),
      centerY: artHeight * 0.36,
      radius: Math.min(artHeight * 0.52, artWidth * (isNarrowScreen ? 0.34 : 0.22)),
    }

    const random = createSeededRandom(711)
    const starCount = Math.round((artWidth * artHeight) / ART_PIXELS_PER_STAR)
    stars = Array.from({ length: starCount }, () =>
      createStar(random, NEAREST_STAR_DEPTH + random() * (1 - NEAREST_STAR_DEPTH)),
    )

    drawFrame(prefersReducedMotion.matches ? 0 : (performance.now() - startTimestamp) / 1000, 0)
  }

  function drawGalaxy(elapsedSeconds: number) {
    const { centerX, centerY, radius } = galaxy
    const rotation = elapsedSeconds * GALAXY_RADIANS_PER_SECOND
    const cosineOfInclination = Math.cos(GALAXY_INCLINATION_RADIANS)
    const sineOfInclination = Math.sin(GALAXY_INCLINATION_RADIANS)

    const left = Math.max(0, Math.floor(centerX - radius))
    const right = Math.min(artWidth - 1, Math.ceil(centerX + radius))
    const top = Math.max(0, Math.floor(centerY - radius))
    const bottom = Math.min(artHeight - 1, Math.ceil(centerY + radius))

    for (let row = top; row <= bottom; row++) {
      for (let column = left; column <= right; column++) {
        const offsetX = column + 0.5 - centerX
        const offsetY = row + 0.5 - centerY
        // Undo the on-screen tilt to get coordinates in the galaxy's own plane.
        const planeX = (offsetX * cosineOfInclination + offsetY * sineOfInclination) / radius
        const planeY = (-offsetX * sineOfInclination + offsetY * cosineOfInclination) / (radius * GALAXY_TILT)
        const distanceFromCenter = Math.hypot(planeX, planeY)
        if (distanceFromCenter > 1) continue

        const angle = Math.atan2(planeY, planeX)
        const armWave = Math.cos(GALAXY_ARM_COUNT * (angle - rotation) - GALAXY_ARM_TWIST * distanceFromCenter)
        const armBrightness = Math.pow((armWave + 1) / 2, 2.5)
        const diskFalloff = Math.pow(1 - distanceFromCenter, 1.6)
        const coreBrightness = Math.exp(-Math.pow(distanceFromCenter / 0.11, 2))
        const brightness = Math.min(1, coreBrightness * 1.2 + armBrightness * diskFalloff * 0.95 + diskFalloff * 0.035)

        if (brightness > BAYER_THRESHOLDS[row % 4][column % 4]) {
          pixelBuffer[row * artWidth + column] =
            coreBrightness > 0.55 ? whitePacked : coreBrightness > 0.2 ? palePacked : accentPacked
        }
      }
    }
  }

  function projectStar(star: Star) {
    // Stars fly outward from the galaxy, as if the viewer is drifting toward it.
    const spanX = Math.max(galaxy.centerX, artWidth - galaxy.centerX)
    const spanY = Math.max(galaxy.centerY, artHeight - galaxy.centerY)
    return {
      x: galaxy.centerX + (star.farPlaneX * spanX) / star.depth,
      y: galaxy.centerY + (star.farPlaneY * spanY) / star.depth,
    }
  }

  function advanceStars(secondsSinceLastFrame: number) {
    for (let index = 0; index < stars.length; index++) {
      const star = stars[index]
      star.depth -= STAR_DEPTH_PER_SECOND * secondsSinceLastFrame
      const { x, y } = projectStar(star)
      const hasPassedViewer = star.depth <= NEAREST_STAR_DEPTH
      const hasLeftCanvas = x < -2 || y < -2 || x > artWidth + 2 || y > artHeight + 2
      if (hasPassedViewer || hasLeftCanvas) stars[index] = createStar(Math.random, 1)
    }
  }

  function drawStars(elapsedSeconds: number) {
    for (const star of stars) {
      const { x, y } = projectStar(star)

      if (star.depth > DIM_STAR_DEPTH) {
        // Distant stars are faint blue and twinkle in and out.
        const isTwinkledOn =
          star.blinkRadiansPerSecond === 0 ||
          Math.sin(elapsedSeconds * star.blinkRadiansPerSecond + star.blinkPhase) > 0.3
        if (isTwinkledOn) setPixel(x, y, dimBluePacked)
        continue
      }

      setPixel(x, y, star.packedColor)
      if (star.depth <= CLOSE_STAR_DEPTH) {
        // Close stars grow into a cross (sparkles) or a 2x2 block.
        if (star.isSparkle) {
          setPixel(x - 1, y, star.packedColor)
          setPixel(x + 1, y, star.packedColor)
          setPixel(x, y - 1, star.packedColor)
          setPixel(x, y + 1, star.packedColor)
        } else {
          setPixel(x + 1, y, star.packedColor)
          setPixel(x, y + 1, star.packedColor)
          setPixel(x + 1, y + 1, star.packedColor)
        }
      }
    }
  }

  function advanceShootingStar(secondsSinceLastFrame: number) {
    if (!shootingStar) {
      secondsUntilNextShootingStar -= secondsSinceLastFrame
      if (secondsUntilNextShootingStar > 0) return
      secondsUntilNextShootingStar = 6 + Math.random() * 8
      shootingStar = {
        x: artWidth * (0.25 + Math.random() * 0.7),
        y: -2,
        velocityX: -(55 + Math.random() * 25),
        velocityY: 28 + Math.random() * 12,
      }
    }

    shootingStar.x += shootingStar.velocityX * secondsSinceLastFrame
    shootingStar.y += shootingStar.velocityY * secondsSinceLastFrame
    const speed = Math.hypot(shootingStar.velocityX, shootingStar.velocityY)
    const directionX = shootingStar.velocityX / speed
    const directionY = shootingStar.velocityY / speed

    for (let trailStep = 0; trailStep < 14; trailStep++) {
      // Thin the tail out with a checkerboard so it fades like the dither.
      if (trailStep > 7 && trailStep % 2 === 1) continue
      setPixel(
        shootingStar.x - directionX * trailStep,
        shootingStar.y - directionY * trailStep,
        trailStep < 2 ? whitePacked : trailStep < 5 ? palePacked : accentPacked,
      )
    }

    if (shootingStar.x < -20 || shootingStar.y > artHeight + 20) shootingStar = null
  }

  function drawFrame(elapsedSeconds: number, secondsSinceLastFrame: number) {
    if (!imageData) return
    if (!prefersReducedMotion.matches) advanceStars(secondsSinceLastFrame)
    pixelBuffer.fill(backgroundPacked)
    drawGalaxy(elapsedSeconds)
    drawStars(elapsedSeconds)
    if (!prefersReducedMotion.matches) advanceShootingStar(secondsSinceLastFrame)
    context!.putImageData(imageData, 0, 0)
  }

  function onAnimationFrame(timestamp: number) {
    animationFrameId = requestAnimationFrame(onAnimationFrame)
    const millisecondsSinceLastDraw = timestamp - lastDrawnTimestamp
    if (millisecondsSinceLastDraw < 1000 / TARGET_FRAMES_PER_SECOND - 2) return
    // Cap the step so a backgrounded tab doesn't fling everything forward.
    const secondsSinceLastFrame = Math.min(millisecondsSinceLastDraw / 1000, 0.1)
    lastDrawnTimestamp = timestamp
    drawFrame((timestamp - startTimestamp) / 1000, secondsSinceLastFrame)
  }

  function startAnimating() {
    if (animationFrameId || prefersReducedMotion.matches || !isOnScreen) return
    lastDrawnTimestamp = performance.now()
    animationFrameId = requestAnimationFrame(onAnimationFrame)
  }

  function stopAnimating() {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = 0
  }

  startTimestamp = performance.now()
  new ResizeObserver(resize).observe(container)
  new IntersectionObserver(([entry]) => {
    isOnScreen = entry.isIntersecting
    if (isOnScreen) startAnimating()
    else stopAnimating()
  }).observe(canvas)
  prefersReducedMotion.addEventListener('change', () => {
    if (prefersReducedMotion.matches) {
      stopAnimating()
      drawFrame(0, 0)
    } else {
      startAnimating()
    }
  })

  resize()
  startAnimating()
}

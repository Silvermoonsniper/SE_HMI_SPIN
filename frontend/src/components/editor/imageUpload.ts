/** Read and decode a local image before adding it to the layout. */
export async function readLayoutImage(file: File): Promise<{ src: string; width: number; height: number }> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.')
  }

  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The image file could not be read.'))
    reader.onabort = () => reject(new Error('Reading the image was cancelled.'))
    reader.readAsDataURL(file)
  })

  const image = new Image()
  image.src = src
  try {
    await image.decode()
  } catch {
    throw new Error('This image could not be opened. Please choose a supported image file.')
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error('The image has no usable dimensions.')
  }

  // Start at a manageable size while preserving the original proportions.
  const scale = Math.min(1, 320 / image.naturalWidth, 240 / image.naturalHeight)
  return {
    src,
    width: Math.max(40, Math.round(image.naturalWidth * scale)),
    height: Math.max(24, Math.round(image.naturalHeight * scale)),
  }
}

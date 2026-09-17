export const CREATOR_STUDIO_PATH = '/creatorstudio'
export function isCreatorStudioPath(pathname) {
  return /^\/(?:creatorstudio|tools)\/?$/.test(pathname)
}
export function creatorStudioPath(pathname) {
  return /^\/tools\/?$/.test(pathname) ? '/tools' : CREATOR_STUDIO_PATH
}

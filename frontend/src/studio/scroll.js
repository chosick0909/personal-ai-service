// Back to the top of the page. In the studio the page scrolls on <body> (html does not scroll), so the window call
// alone leaves the screen where it was.
export const toTop = () => { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0 }

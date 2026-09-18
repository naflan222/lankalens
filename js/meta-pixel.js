/* Meta Pixel for LankaLens.
   The external Meta library is loaded asynchronously. The initial page view and
   hash-route changes are tracked because LankaLens is a single-page app. */
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');

fbq('init', '2295151224578176');
fbq('track', 'PageView');

(function () {
  var lastLocation = window.location.pathname + window.location.search + window.location.hash;
  window.addEventListener('hashchange', function () {
    var nextLocation = window.location.pathname + window.location.search + window.location.hash;
    if (nextLocation === lastLocation) return;
    lastLocation = nextLocation;
    fbq('track', 'PageView');
  });
}());

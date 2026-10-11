// Explicitly selected, deterministic sample data. Never mixed with stored metrics.
export function demoReport(days) {
  const today = new Date(Date.now() + 9 * 3600000);
  const series = Array.from({ length: days }, (_, i) => ({ day: new Date(today.getTime() - (days - i - 1) * 86400000).toISOString().slice(0, 10), views: [34, 48, 39, 62, 91, 54, 73][i % 7] }));
  const views = series.reduce((sum, x) => sum + x.views, 0);
  const count = fraction => Math.round(views * fraction);
  const split = entries => entries.map(([label, fraction]) => ({ label, value: count(fraction) }));
  return {
    demo: true, timezone: 'Asia/Seoul', days, from: series[0].day, to: series.at(-1).day, series,
    totals: { views, active_seconds: views * 42, engaged_views: count(.68), clicks: count(.42), downloads: count(.09), outbound_clicks: count(.2), scroll_25: count(.84), scroll_50: count(.63), scroll_75: count(.38), scroll_100: count(.2), video_plays: count(.18), video_completions: count(.08), section_opens: count(.24), load_ms: views * 780, ttfb_ms: views * 140, performance_samples: views },
    pages: [['/', 'Homepage', .43], ['/scooping_robotic_hand/', 'Scooping with a Robotic Hand', .26], ['/contact_residual_learning/', 'Contact Residual Learning', .18], ['/bilateral_leader_arm/', 'Bilateral Leader Arm', .13]].map(([path, name, fraction]) => ({ path, name, views: count(fraction), active_seconds: count(fraction) * 42, scroll_50: count(fraction * .63), clicks: count(fraction * .42) })),
    breakdowns: {
      source: split([['Google', .41], ['Direct / unknown', .3], ['Internal', .17], ['GitHub', .12]]),
      country: split([['KR', .45], ['US', .28], ['DE', .13], ['JP', .09], ['Other / low volume', .05]]),
      region: split([['KR-11', .28], ['US-CA', .18], ['KR-41', .17], ['Unknown', .37]]),
      device: split([['Desktop / other', .71], ['Mobile', .26], ['Tablet', .03]]),
      browser: split([['Chrome', .65], ['Safari', .22], ['Firefox', .08], ['Edge', .05]]),
      os: split([['Windows', .42], ['macOS', .28], ['iOS', .16], ['Android', .14]]),
      link: split([['CV', .09], ['Google Scholar', .08], ['GitHub', .07], ['IEEE', .05], ['/scooping_robotic_hand/', .13]]),
      section: split([['research', .14], ['award', .07], ['personal', .03]]),
      hour: Array.from({ length: 24 }, (_, hour) => ({ label: String(hour).padStart(2, '0'), value: Math.max(1, Math.round(views * ([1, 1, 1, 1, 1, 2, 3, 4, 6, 7, 6, 5, 5, 7, 8, 7, 6, 5, 5, 4, 4, 4, 3, 2][hour]) / 108)) }))
    }
  };
}

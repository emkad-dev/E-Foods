import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { adminTheme } from '../../theme/palette';

export type DonutSegment = {
  color: string;
  label: string;
  value: number;
};

type DonutChartProps = {
  centerLabel: string;
  centerSubLabel?: string;
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
};

export default function DonutChart({
  centerLabel,
  centerSubLabel,
  segments,
  size = 160,
  strokeWidth = 22,
}: DonutChartProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, segment) => sum + Math.max(segment.value, 0), 0);

  let cumulativeOffset = 0;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.chartRow, { height: size }]}>
        <Svg width={size} height={size}>
          <G rotation={-90} originX={size / 2} originY={size / 2}>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={adminTheme.surfaceMuted}
              strokeWidth={strokeWidth}
              fill="none"
            />
            {total > 0
              ? segments.map((segment) => {
                  const fraction = Math.max(segment.value, 0) / total;
                  const dashLength = fraction * circumference;
                  const circle = (
                    <Circle
                      key={segment.label}
                      cx={size / 2}
                      cy={size / 2}
                      r={radius}
                      stroke={segment.color}
                      strokeWidth={strokeWidth}
                      strokeLinecap="butt"
                      fill="none"
                      strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                      strokeDashoffset={-cumulativeOffset}
                    />
                  );
                  cumulativeOffset += dashLength;
                  return circle;
                })
              : null}
          </G>
        </Svg>
        <View style={[styles.center, { width: size, height: size }]}>
          <Text style={styles.centerLabel} numberOfLines={1}>
            {centerLabel}
          </Text>
          {centerSubLabel ? <Text style={styles.centerSubLabel}>{centerSubLabel}</Text> : null}
        </View>
      </View>

      <View style={styles.legend}>
        {segments.map((segment) => (
          <View key={segment.label} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: segment.color }]} />
            <Text style={styles.legendLabel}>{segment.label}</Text>
            <Text style={styles.legendValue}>{segment.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  chartRow: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  centerLabel: {
    color: adminTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  centerSubLabel: {
    color: adminTheme.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  legend: {
    gap: 10,
  },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  legendDot: {
    borderRadius: 4,
    height: 12,
    width: 12,
  },
  legendLabel: {
    color: adminTheme.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  legendValue: {
    color: adminTheme.text,
    fontSize: 13,
    fontWeight: '800',
  },
});

import { StyleSheet, Text, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { adminTheme } from '../../theme/palette';

export type BarDatum = {
  label: string;
  value: number;
};

type CumulativeBarChartProps = {
  barColor?: string;
  data: BarDatum[];
  height?: number;
};

export default function CumulativeBarChart({
  barColor = adminTheme.accent,
  data,
  height = 180,
}: CumulativeBarChartProps) {
  const width = 320;
  const paddingLeft = 8;
  const paddingRight = 8;
  const paddingTop = 12;
  const axisLabelHeight = 22;
  const valueLabelHeight = 16;

  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - axisLabelHeight - valueLabelHeight;
  const baselineY = paddingTop + valueLabelHeight + plotHeight;

  const maxValue = Math.max(1, ...data.map((datum) => datum.value));
  const slotWidth = data.length > 0 ? plotWidth / data.length : plotWidth;
  const barWidth = Math.min(34, slotWidth * 0.56);

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Line
          x1={paddingLeft}
          y1={baselineY}
          x2={width - paddingRight}
          y2={baselineY}
          stroke={adminTheme.border}
          strokeWidth={1}
        />
        {data.map((datum, index) => {
          const barHeight = (datum.value / maxValue) * plotHeight;
          const slotCenter = paddingLeft + slotWidth * index + slotWidth / 2;
          const barX = slotCenter - barWidth / 2;
          const barY = baselineY - barHeight;

          return (
            <G key={datum.label}>
              <Rect
                x={barX}
                y={barY}
                width={barWidth}
                height={Math.max(barHeight, 0)}
                rx={5}
                fill={barColor}
              />
              <SvgText
                x={slotCenter}
                y={barY - 5}
                fill={adminTheme.text}
                fontSize={11}
                fontWeight="700"
                textAnchor="middle"
              >
                {String(datum.value)}
              </SvgText>
              <SvgText
                x={slotCenter}
                y={baselineY + 15}
                fill={adminTheme.textMuted}
                fontSize={11}
                textAnchor="middle"
              >
                {datum.label}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      {data.length === 0 ? <Text style={styles.emptyText}>No orders in the last 7 days.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: {
    color: adminTheme.textMuted,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
});

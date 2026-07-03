import { ScrollView, StyleSheet, Text, View } from 'react-native';

const deals = [
  { title: 'Free delivery', copy: 'Available on selected restaurants this week.' },
  { title: 'Lunch deals', copy: 'Save on midday orders from nearby kitchens.' },
  { title: 'New restaurant picks', copy: 'Check out recently added spots in your area.' },
];

export default function DealsScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Deals</Text>
      {deals.map((deal) => (
        <View key={deal.title} style={styles.card}>
          <Text style={styles.cardTitle}>{deal.title}</Text>
          <Text style={styles.cardCopy}>{deal.copy}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#fff',
    flex: 1,
  },
  container: {
    backgroundColor: '#fff',
    flexGrow: 1,
    padding: 20,
  },
  title: {
    color: '#111',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#fff8e8',
    borderRadius: 14,
    marginBottom: 14,
    padding: 16,
  },
  cardTitle: {
    color: '#7a4c00',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardCopy: {
    color: '#6a5a3a',
    fontSize: 15,
    lineHeight: 22,
  },
});

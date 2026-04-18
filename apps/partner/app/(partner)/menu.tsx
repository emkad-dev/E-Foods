import { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { usePartnerRestaurant } from '../../src/hooks/usePartnerRestaurant';
import { savePartnerRestaurantMenu, type PartnerMenuCategoryInput } from '../../src/services/partnerRestaurantActions';
import { partnerTheme } from '../../src/theme/palette';

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export default function PartnerMenuScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { error, loading, restaurant } = usePartnerRestaurant();
  const [saving, setSaving] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemImage, setItemImage] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);

  const menu = useMemo(() => restaurant?.menu ?? [], [restaurant?.menu]);

  const resetForm = () => {
    setEditingItemId(null);
    setCategory('');
    setItemName('');
    setItemDescription('');
    setItemPrice('');
    setItemImage('');
    setIsAvailable(true);
  };

  const handleSaveItem = async () => {
    if (!restaurant?.id || !user) {
      Alert.alert('Store setup needed', 'Create or link a restaurant record on the Store tab before adding meals.');
      return;
    }

    if (!category.trim() || !itemName.trim() || !itemPrice.trim()) {
      Alert.alert('Missing details', 'Add a category, meal name, and price before saving.');
      return;
    }

    const parsedPrice = Number.parseFloat(itemPrice);

    if (!Number.isFinite(parsedPrice)) {
      Alert.alert('Invalid price', 'Use a valid numeric price for this meal.');
      return;
    }

    setSaving(true);

    try {
      const normalizedCategory = category.trim();
      const itemId = editingItemId ?? `${toSlug(itemName)}-${Date.now()}`;
      const nextMenu: PartnerMenuCategoryInput[] = [...menu].map((menuCategory) => ({
        category: menuCategory.category,
        items: [...menuCategory.items],
      }));
      const categoryIndex = nextMenu.findIndex(
        (menuCategory) => menuCategory.category.trim().toLowerCase() === normalizedCategory.toLowerCase()
      );

      const nextItem = {
        id: itemId,
        name: itemName.trim(),
        description: itemDescription.trim(),
        price: parsedPrice,
        image: itemImage.trim() || undefined,
        isAvailable,
      };

      if (categoryIndex >= 0) {
        const existingItemIndex = nextMenu[categoryIndex].items.findIndex((item) => item.id === itemId);

        if (existingItemIndex >= 0) {
          nextMenu[categoryIndex].items[existingItemIndex] = nextItem;
        } else {
          nextMenu[categoryIndex].items.push(nextItem);
        }
      } else {
        nextMenu.push({
          category: normalizedCategory,
          items: [nextItem],
        });
      }

      await savePartnerRestaurantMenu(restaurant.id, nextMenu, user.uid);
      resetForm();
      Alert.alert('Menu saved', `${nextItem.name} is now available in ${normalizedCategory}.`);
    } catch (nextError: any) {
      Alert.alert('Save failed', nextError.message ?? 'Unable to save this menu item right now.');
    } finally {
      setSaving(false);
    }
  };

  const handleEditItem = (categoryName: string, item: PartnerMenuCategoryInput['items'][number]) => {
    setEditingItemId(item.id);
    setCategory(categoryName);
    setItemName(item.name);
    setItemDescription(item.description ?? '');
    setItemPrice(String(item.price));
    setItemImage(item.image ?? '');
    setIsAvailable(item.isAvailable !== false);
  };

  const handleRemoveItem = async (categoryName: string, itemId: string) => {
    if (!restaurant?.id || !user) {
      return;
    }

    setSaving(true);

    try {
      const nextMenu = menu
        .map((menuCategory) => {
          if (menuCategory.category !== categoryName) {
            return menuCategory;
          }

          return {
            ...menuCategory,
            items: menuCategory.items.filter((item) => item.id !== itemId),
          };
        })
        .filter((menuCategory) => menuCategory.items.length > 0);

      await savePartnerRestaurantMenu(restaurant.id, nextMenu, user.uid);

      if (editingItemId === itemId) {
        resetForm();
      }
    } catch (nextError: any) {
      Alert.alert('Remove failed', nextError.message ?? 'Unable to remove this meal right now.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>Menu builder</Text>
      <Text style={styles.subtitle}>Add categories and meals that the customer app can render immediately.</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Meal editor</Text>
        {!restaurant ? (
          <Text style={styles.emptyCopy}>Set up or link a restaurant on the Store tab before building a menu.</Text>
        ) : null}
        <TextInput style={styles.input} placeholder="Category e.g. Shawarma" value={category} onChangeText={setCategory} />
        <TextInput style={styles.input} placeholder="Meal name" value={itemName} onChangeText={setItemName} />
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Meal description"
          value={itemDescription}
          onChangeText={setItemDescription}
          multiline
        />
        <TextInput
          style={styles.input}
          placeholder="Price"
          value={itemPrice}
          onChangeText={setItemPrice}
          keyboardType="decimal-pad"
        />
        <TextInput style={styles.input} placeholder="Image URL (optional)" value={itemImage} onChangeText={setItemImage} />
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Available for ordering</Text>
          <Switch
            value={isAvailable}
            onValueChange={setIsAvailable}
            trackColor={{ false: '#d1d5db', true: partnerTheme.accentSoft }}
            thumbColor={isAvailable ? partnerTheme.accent : '#f3f4f6'}
          />
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.primaryButton, !restaurant ? styles.primaryButtonDisabled : null]}
            onPress={handleSaveItem}
            disabled={!restaurant || saving || loading}
          >
            <Text style={styles.primaryButtonText}>
              {saving ? 'Saving...' : editingItemId ? 'Save meal changes' : 'Add meal'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={resetForm} disabled={saving}>
            <Text style={styles.secondaryButtonText}>{editingItemId ? 'Cancel edit' : 'Reset form'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Live menu</Text>
        {menu.length === 0 ? <Text style={styles.emptyCopy}>No categories yet. Start by adding the first meal above.</Text> : null}
        {menu.map((menuCategory) => (
          <View key={menuCategory.category} style={styles.categoryBlock}>
            <Text style={styles.categoryTitle}>{menuCategory.category}</Text>
            {menuCategory.items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={styles.itemMeta}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemInfo}>
                    ${item.price.toFixed(2)} | {item.isAvailable === false ? 'Unavailable' : 'Available'}
                  </Text>
                  {item.description ? <Text style={styles.itemDescription}>{item.description}</Text> : null}
                </View>
                <View style={styles.itemActions}>
                  <TouchableOpacity style={styles.inlineAction} onPress={() => handleEditItem(menuCategory.category, item)}>
                    <Text style={styles.inlineActionText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.inlineAction, styles.inlineDanger]}
                    onPress={() => handleRemoveItem(menuCategory.category, item.id)}
                    disabled={saving}
                  >
                    <Text style={[styles.inlineActionText, styles.inlineDangerText]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    paddingBottom: 30,
    paddingHorizontal: 18,
  },
  title: {
    color: partnerTheme.text,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 13,
    marginTop: 12,
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderRadius: 20,
    marginTop: 14,
    padding: 18,
  },
  cardTitle: {
    color: partnerTheme.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  input: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderColor: partnerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 14,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  toggleLabel: {
    color: partnerTheme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  actionRow: {
    gap: 10,
    marginTop: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 16,
    paddingVertical: 14,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 16,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  emptyCopy: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  categoryBlock: {
    borderTopColor: partnerTheme.border,
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 14,
  },
  categoryTitle: {
    color: partnerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  itemRow: {
    borderColor: partnerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  itemMeta: {
    flex: 1,
  },
  itemName: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  itemInfo: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    marginTop: 4,
  },
  itemDescription: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  itemActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  inlineAction: {
    backgroundColor: partnerTheme.accentSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineActionText: {
    color: partnerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  inlineDanger: {
    backgroundColor: '#fee2e2',
  },
  inlineDangerText: {
    color: partnerTheme.danger,
  },
});

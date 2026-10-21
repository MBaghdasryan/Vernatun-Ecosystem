import type { ComponentProps, ReactNode } from 'react';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Platform, ScrollView, type ScrollViewProps } from 'react-native';

type Props = ComponentProps<typeof KeyboardAwareScrollView> & ScrollViewProps & { children?: ReactNode };

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  bottomOffset = 24,
  ...props
}: Props) {
  if (Platform.OS === 'web') {
    return (
      <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
        {children}
      </ScrollView>
    );
  }

  return (
    <KeyboardAwareScrollView bottomOffset={bottomOffset} keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
      {children}
    </KeyboardAwareScrollView>
  );
}

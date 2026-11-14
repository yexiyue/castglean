import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { cn } from "cn";
import { inputClassName } from "@/components/ui/input";

const NumberField = NumberFieldPrimitive.Root;

function NumberFieldInput({
  className,
  ...props
}: NumberFieldPrimitive.Input.Props) {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      className={cn(inputClassName, className)}
      {...props}
    />
  );
}

export { NumberField, NumberFieldInput };

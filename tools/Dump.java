import java.lang.reflect.*;
import java.util.*;
import volute.Engine;

public final class Dump {
  public static void main(String[] args) throws Exception {
    Object result;
    if (args.length > 0 && args[0].equals("price")) {
      var p =
          new Engine.Params(
              Double.parseDouble(args[1]),
              Double.parseDouble(args[2]),
              Double.parseDouble(args[3]),
              Double.parseDouble(args[4]),
              Double.parseDouble(args[5]));
      result =
          Engine.price(
              p,
              Double.parseDouble(args[6]),
              Double.parseDouble(args[7]),
              args.length > 8 && args[8].equals("fine"));
    } else
      result =
          Engine.run(
              args.length == 0
                  ? Engine.defaults()
                  : new Engine.Config(
                      Integer.parseInt(args[0]),
                      Double.parseDouble(args[1]),
                      Integer.parseInt(args[2])));
    System.out.println(json(result));
  }

  static String json(Object o) throws Exception {
    if (o == null) return "null";
    if (o instanceof Number || o instanceof Boolean) return o.toString();
    if (o.getClass().isArray()) {
      List<String> a = new ArrayList<>();
      for (int i = 0; i < Array.getLength(o); i++) a.add(json(Array.get(o, i)));
      return "[" + String.join(",", a) + "]";
    }
    if (o.getClass().isRecord()) {
      List<String> a = new ArrayList<>();
      for (var c : o.getClass().getRecordComponents())
        a.add("\"" + c.getName() + "\":" + json(c.getAccessor().invoke(o)));
      return "{" + String.join(",", a) + "}";
    }
    throw new IllegalArgumentException("Unsupported output");
  }
}

const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const bodyParser = require('body-parser');
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

app.post("/subscribe-email", (req, res) => {
  const { email } = req.body;

  // Configure your email transporter
  const transporter = nodemailer.createTransport({
    service: "Gmail", // e.g., 'Gmail'
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
    tls:{
      rejectUnauthorized: false
    }
  });

  // Email data
  const mailOptions = {
    from: 'The Music Studio',
    to: email,
    subject: 'Thank You for Subscribing',
    text: 'Thank you for subscribing to our newsletter!',
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Email sending failed:", error);
      res.status(500).json({ message: "Failed to send thank you email" });
    } else {
      console.log("Email sent:", info.response);
      res.json({ message: "Subscription successful" });
    }
  });
});

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }
  // bearer token
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      console.log(err);
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.92d2eha.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const userCollection = client.db("musicStudio").collection("users");
    const courseCollection = client.db("musicStudio").collection("courses");
    const cartCollection = client.db("musicStudio").collection("carts");
    const paymentCollection = client.db("musicStudio").collection("payments");
    const reviewCollection = client.db("musicStudio").collection("reviews");

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN, {
        expiresIn: "170h",
      });
      res.send({ token });
    });

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden message" });
      }
      next();
    };

    const verifyInstructor = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      console.log(user);
      if (user?.role !== "instructor") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden message" });
      }
      next();
    };

    // Users Api
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/instructor", async (req, res) => {
      const instructors = await userCollection
        .find({ role: "instructor" })
        .toArray();
      res.send(instructors);
    });

    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //! Instructor

    app.get("/users/instructor/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ instructor: false });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { instructor: user?.role === "instructor" };
      res.send(result);
    });

    app.patch("/users/instructor/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "instructor",
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists" });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // Delete
    app.delete("/users/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    //! Course
    app.get("/courses", async (req, res) => {
      const nonPendingCourses = await courseCollection
        .find({ status: { $ne: "pending" } })
        .toArray();
      const enrolledCourses = await cartCollection
        .aggregate([{ $group: { _id: "$courseId", count: { $sum: 1 } } }])
        .toArray();
      const coursesWithEnrollment = nonPendingCourses.map((course) => {
        const enrollment = enrolledCourses.find(
          (e) => e._id.toString() === course._id.toString()
        );
        return {
          ...course,
          enrollmentCount: enrollment ? enrollment.count : 0,
        };
      });
      res.send(coursesWithEnrollment);
    });

    app.get("/courses/instructor", async (req, res) => {
      let query = {};
      if (req.query?.email) {
        query = { instructorEmail: req.query.email };
      }
      const result = await courseCollection.find(query).toArray();
      res.send(result);
    });

    // Pending Course

    app.get("/courses/pending", verifyJWT, verifyAdmin, async (req, res) => {
      const pendingCourse = await courseCollection
        .find({ status: "pending" })
        .toArray();
      res.send(pendingCourse);
    });

    // Approved Course

    app.get("/courses/approved", async (req, res) => {
      const approvedCourse = await courseCollection
        .find({ status: "approved" })
        .toArray();
      res.send(approvedCourse);
    });

    // Add a course

    app.post("/course", verifyJWT, verifyInstructor, async (req, res) => {
      const course = req.body;
      course.status = "pending";
      const result = await courseCollection.insertOne(course);
      res.send(result);
    });

    //! Reviews
    app.get("/reviews", async (req, res) => {
      const review = await reviewCollection.find().toArray();
      res.send(review);
    });

    // Approved

    // app.patch("/courses/approve/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const filter = { _id: new ObjectId(id) };
    //   const updateDoc = {
    //     $set: {
    //       status: req.body.status,
    //     },
    //   };
    //   const result = await courseCollection.updateOne(filter, updateDoc);
    //   res.send(result);
    // });

    app.patch("/courses/admin/:id", async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: req.body.status,
        },
      };
      const result = await courseCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //! Cart

    app.get("/carts", verifyJWT, async (req, res) => {
      const email = req.query.email;

      if (!email) {
        res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }

      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result);
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    //! Payment
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", verifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);

      const query = {
        _id: { $in: payment.course.map((id) => new ObjectId(id)) },
      };
      const deleteResult = await cartCollection.deleteMany(query);

      const updateResult = await courseCollection.updateOne(
        { _id: new ObjectId(payment.course[0]), seats: { $gt: 0 } },
        { $inc: { seats: -1, enrolled: 1 } }
      );

      if (updateResult.matchedCount > 0) {
        // Seats were available and updated successfully
        console.log("Seats updated successfully");
        res.status(200).send({ insertResult, deleteResult, updateResult });
      } else {
        // No seats available
        console.log("No seats available for this course");
        res.status(400).send({ error: true, message: "No seats available" });
      }
    });

    // Payment History
    app.get("/enrolled", verifyJWT, async (req, res) => {
      const email = req.decoded.email;
      const query = { email: email };
      const enrolledCourses = await paymentCollection.find(query).toArray();
      res.send(enrolledCourses);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Studio is running");
});

app.listen(port, () => {
  console.log(`Studio is running on port ${port}`);
});
